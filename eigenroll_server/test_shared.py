import json, os
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from django.core import signing
from .shared import GatewayError
ENV={'SUPABASE_URL':'https://example.supabase.co','SUPABASE_PUBLISHABLE_KEY':'public-test-key','EIGENROLL_SERVER_TOKEN':'server-test-token','EIGENROLL_TEACHER_PASSWORD':'teacher-test-key','DJANGO_SECRET_KEY':'test-key'}
@patch.dict(os.environ,ENV)
class SharedSecurityTests(SimpleTestCase):
    def post(self,path,data):return self.client.post(path,json.dumps(data),content_type='application/json')
    def login(self):
        with patch('eigenroll_server.shared.db',return_value=True):
            return self.post('/api/auth',{'password':'teacher-test-key'})
    def test_teacher_workspace_is_not_public(self):
        for path in ['/api/workspace','/api/enrollments']:
            self.assertEqual(self.client.get(path).status_code,401)
    def test_login_checks_key_and_uses_http_only_cookie(self):
        with patch('eigenroll_server.shared.db',return_value=True):
            self.assertEqual(self.post('/api/auth',{'password':'wrong'}).status_code,401)
        response=self.login();self.assertEqual(response.status_code,200)
        self.assertTrue(response.cookies['eigenroll_teacher']['httponly'])
        self.assertEqual(response.cookies['eigenroll_teacher']['samesite'],'Strict')
        self.assertTrue(self.client.get('/api/auth').json()['teacher'])
    def test_remembered_smartboard_stays_signed_in_and_session_expires(self):
        with patch('eigenroll_server.shared.db',return_value=True):
            response=self.post('/api/auth',{'password':'teacher-test-key','remember':True})
        self.assertEqual(response.cookies['eigenroll_teacher']['max-age'],30*24*3600)
        with patch('django.core.signing.time.time',side_effect=lambda:__import__('time').time_ns()/1e9+10*24*3600):
            self.assertTrue(self.client.get('/api/auth').json()['teacher'])
        self.login()
        with patch('django.core.signing.time.time',side_effect=lambda:__import__('time').time_ns()/1e9+9*3600):
            self.assertFalse(self.client.get('/api/auth').json()['teacher'])
    def test_teacher_can_save_a_large_recognition_model_but_not_unbounded(self):
        self.login()
        model={'id':'models:classroom','kind':'models','payload':{'blob':'x'*1_800_000}}
        with patch('eigenroll_server.shared.db',return_value=[{'revision':1}]):
            self.assertEqual(self.post('/api/workspace',model).status_code,200)
        model['payload']['blob']='x'*3_100_000
        self.assertEqual(self.post('/api/workspace',model).status_code,413)
    def test_tampered_teacher_cookie_is_rejected(self):
        self.client.cookies['eigenroll_teacher']='forged'
        self.assertEqual(self.client.get('/api/workspace').status_code,401)
    def test_expired_invite_is_rejected(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        with patch('django.core.signing.time.time',return_value=10**11):
            self.assertEqual(self.client.get('/api/enroll',{'invite':token}).status_code,400)
    def test_public_class_information_never_contains_roster(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        with patch('eigenroll_server.shared.db',return_value=[{'payload':{'name':'Our classroom'}}]):
            response=self.client.get('/api/enroll',{'invite':token})
        self.assertEqual(response.json(),{'classId':'classroom','className':'Our classroom'})
    def test_enrollment_requires_consent_and_20_samples(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        path='/api/enroll?invite='+token
        def gateway(path,*args):return True if path.startswith('rpc/') else [{'payload':{'name':'Our classroom'}}]
        with patch('eigenroll_server.shared.db',side_effect=gateway):
            self.assertEqual(self.post(path,{'name':'Student','roll':'1','faces':[]}).status_code,400)
            self.assertEqual(self.post(path,{'name':'Student','roll':'1','faces':[],'consent':True}).status_code,400)
    def face(self,embedding=True):
        return {'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576,**({'embedding':[0.01]*128} if embedding else {})}
    def test_registration_joins_the_roster_immediately_and_duplicates_are_rejected(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment');written=[]
        payload={'name':' Asha Rao ','roll':'70382200099','consent':True,'faces':[self.face() for _ in range(20)],'classroom':[[0.02]*128]*8}
        def gateway(path,method='GET',body=None,*args):
            if path.startswith('rpc/'):return True
            if 'eq.classes' in path:return [{'payload':{'name':'Our classroom'}}]
            if method=='POST':written.append((path,body));return None
            return []
        with patch('eigenroll_server.shared.db',side_effect=gateway):
            r=self.post('/api/enroll?invite='+token,payload)
        self.assertEqual(r.status_code,201);self.assertIn('registered',r.json()['message'])
        path,body=written[0];self.assertEqual(path,'eigenroll_entities');self.assertEqual(body['kind'],'students')
        self.assertEqual(body['payload']['name'],'Asha Rao');self.assertEqual(body['payload']['classId'],'classroom');self.assertEqual(len(body['payload']['classroom']),8)
        self.assertEqual(body['id'],'students:'+body['payload']['id'])
        def duplicate(path,method='GET',body=None,*args):
            if 'eq.students' in path:return [{'payload':{'roll':'70382200099'}}]
            return gateway(path,method,body,*args)
        with patch('eigenroll_server.shared.db',side_effect=duplicate):
            self.assertEqual(self.post('/api/enroll?invite='+token,payload).status_code,409)
    def test_registration_needs_face_features_and_valid_classroom_features(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        def gateway(path,*args):return True if path.startswith('rpc/') else ([] if 'eq.students' in path else [{'payload':{'name':'Our classroom'}}])
        base={'name':'Student','roll':'1','consent':True}
        with patch('eigenroll_server.shared.db',side_effect=gateway):
            self.assertEqual(self.post('/api/enroll?invite='+token,{**base,'faces':[self.face(False) for _ in range(20)]}).status_code,400)
            self.assertEqual(self.post('/api/enroll?invite='+token,{**base,'faces':[self.face() for _ in range(20)],'classroom':[[9.0]*128]}).status_code,400)
            self.assertEqual(self.post('/api/enroll?invite='+token,{**base,'faces':[self.face() for _ in range(20)],'classroom':[[0.0]*128]*33}).status_code,400)
            # Feature sizes must be whole pixel widths, one per feature.
            self.assertEqual(self.post('/api/enroll?invite='+token,{**base,'faces':[self.face() for _ in range(20)],'classroom':[[0.0]*128]*3,'classroomPx':[80,36]}).status_code,400)
            self.assertEqual(self.post('/api/enroll?invite='+token,{**base,'faces':[self.face() for _ in range(20)],'classroom':[[0.0]*128]*2,'classroomPx':[80,'x']}).status_code,400)
    def test_attendance_board_needs_no_key_and_never_sends_photos(self):
        student={'id':'s','name':'Student','roll':'123','classId':'classroom','faces':[{'image':'private-photo','vector':[1.0]*576,'embedding':[0.123456789]*128}]*20,'classroom':[[0.2]*128]*8}
        with patch('eigenroll_server.shared.db',return_value=[{'payload':student}]) as db:
            r=self.client.get('/api/attendance?kind=snapshot')
        self.assertEqual(r.status_code,200);self.assertEqual(db.call_count,1);self.assertIn('payload-%3E%3EclassId=eq.classroom',db.call_args.args[0])
        snap=r.json();s=snap['students'][0]
        self.assertNotContains(r,'private-photo');self.assertEqual(s['faces'][0]['vector'],[]);self.assertEqual(s['faces'][0]['embedding'][0],0.12346)
        self.assertEqual(len(s['classroom']),8);self.assertEqual(r['Cache-Control'],'no-store');self.assertNotIn('classroomPx',s)
        with patch('eigenroll_server.shared.db',return_value=[{'payload':{**student,'classroomPx':[80,36,24,80,36,24,80,80]}}]):
            self.assertEqual(self.client.get('/api/attendance?kind=snapshot').json()['students'][0]['classroomPx'][2],24)
        self.assertEqual(self.client.get('/api/attendance?kind=students').status_code,400)
        self.assertEqual(self.post('/api/attendance',{}).status_code,405)
        self.assertEqual(self.post('/api/workspace',{}).status_code,401)
    def test_attendance_snapshot_pages_without_truncating_the_roster(self):
        row={'payload':{'id':'s','name':'Student','roll':'123','classId':'classroom','faces':[]}}
        with patch('eigenroll_server.shared.db',side_effect=[[row]*100,[row]]) as db:
            response=self.client.get('/api/attendance?kind=snapshot')
        self.assertEqual(len(response.json()['students']),101)
        self.assertIn('offset=100',db.call_args.args[0])
    def test_concurrent_teacher_change_returns_conflict(self):
        self.login()
        with patch('eigenroll_server.shared.db',return_value=[]):
            self.assertEqual(self.post('/api/workspace',{'id':'classes:c','kind':'classes','payload':{'name':'Class'},'revision':1}).status_code,409)
    def test_csrf_protects_submission_and_login(self):
        from django.test import Client
        client=Client(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/auth','{}',content_type='application/json').status_code,403)
        self.assertEqual(client.post('/api/enroll','{}',content_type='application/json').status_code,403)


    def test_enrollment_rejects_malformed_identity_features(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        payload={'name':'Student','roll':'1','consent':True,'faces':[{'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576,'embedding':[0.0]*127} for _ in range(20)]}
        def gateway(path,*args):return True if path.startswith('rpc/') else [{'payload':{'name':'Our classroom'}}]
        with patch('eigenroll_server.shared.db',side_effect=gateway):
            self.assertEqual(self.post('/api/enroll?invite='+token,payload).status_code,400)

    def test_database_gateway_accepts_compressed_responses(self):
        import gzip
        from unittest.mock import MagicMock
        from .shared import db
        response=MagicMock()
        response.headers={'Content-Encoding':'gzip'}
        response.read.return_value=gzip.compress(b'[{"id":"example"}]')
        with patch('eigenroll_server.shared.urlopen') as transport:
            transport.return_value.__enter__.return_value=response
            self.assertEqual(db('eigenroll_entities'),[{'id':'example'}])
            self.assertEqual(transport.call_args.args[0].get_header('Accept-encoding'),'gzip')


@patch.dict(os.environ,ENV)
class SideViewTests(SimpleTestCase):
    def post(self,path,payload):return self.client.post(path,json.dumps(payload),content_type='application/json')
    def face(self,shift,yaw):return {'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576,'embedding':[0.01+shift]*128,'yaw':yaw}
    def setUp(self):
        self.token=signing.dumps({'classId':'classroom'},salt='enrollment')
        self.stored={'id':'students:s1','revision':3,'payload':{'id':'s1','classId':'classroom','name':'Asha','roll':'7','faces':[self.face(0,0.0) for _ in range(20)],'classroom':[[0.02]*128]*8}}
    def run_with(self,faces):
        written=[]
        def gateway(path,method='GET',body=None,*args):
            if path.startswith('rpc/'):return True
            if method=='PATCH':written.append((path,body));return [{'revision':4}]
            return [self.stored]
        with patch.dict(os.environ,ENV),patch('eigenroll_server.shared.db',side_effect=gateway):
            r=self.post('/api/side-views?invite='+self.token,{'roll':'7','faces':faces,'classroom':[[0.03]*128]*4})
        return r,written
    def test_matching_student_adds_side_views(self):
        faces=[self.face(0.001,0.0)]*2+[self.face(0.003,0.6)]*2+[self.face(0.003,-0.5)]*2
        r,written=self.run_with(faces)
        self.assertEqual(r.status_code,200,r.content)
        path,body=written[0];self.assertIn('revision=eq.3',path);self.assertEqual(body['revision'],4)
        self.assertEqual(len(body['payload']['faces']),26);self.assertEqual(len(body['payload']['classroom']),12);self.assertEqual(body['payload']['classroomVersion'],2)
        self.assertNotIn('classroomPx',body['payload'])
    def test_side_views_keep_feature_sizes_in_step(self):
        self.stored['payload']['classroomPx']=[80,36,24]*2+[80,36]
        r,written=self.run_with([self.face(0.001,0.0)]*2+[self.face(0.003,0.6)]*2+[self.face(0.003,-0.5)]*2)
        self.assertEqual(r.status_code,200,r.content);self.assertEqual(written[0][1]['payload']['classroomPx'],[80,36,24]*2+[80,36]+[80]*4)
    def test_someone_else_cannot_add_faces_to_a_registration(self):
        faces=[self.face(0.2,0.0)]*2+[self.face(0.2,0.6)]*2+[self.face(0.2,-0.5)]*2
        r,written=self.run_with(faces)
        self.assertEqual(r.status_code,403);self.assertEqual(written,[])
    def test_side_views_must_cover_both_sides(self):
        r,written=self.run_with([self.face(0.001,0.0)]*4+[self.face(0.003,0.6)]*2)
        self.assertEqual(r.status_code,400);self.assertEqual(written,[])
