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
    def test_roster_and_face_templates_are_teacher_only(self):
        with patch('eigenroll_server.shared.db',return_value=[]) as db:
            for kind in ['snapshot','students','models']:
                response=self.client.get('/api/attendance?kind='+kind)
                self.assertEqual(response.status_code,401)
        db.assert_not_called()
    def test_remembered_smartboard_stays_signed_in_and_session_expires(self):
        with patch('eigenroll_server.shared.db',return_value=True):
            response=self.post('/api/auth',{'password':'teacher-test-key','remember':True})
        self.assertEqual(response.cookies['eigenroll_teacher']['max-age'],30*24*3600)
        with patch('django.core.signing.time.time',side_effect=lambda:__import__('time').time_ns()/1e9+10*24*3600):
            self.assertTrue(self.client.get('/api/auth').json()['teacher'])
        self.login()
        with patch('django.core.signing.time.time',side_effect=lambda:__import__('time').time_ns()/1e9+9*3600):
            self.assertFalse(self.client.get('/api/auth').json()['teacher'])
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
    def test_valid_submission_is_pending_and_duplicate_is_rejected(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        payload={'name':'Student','roll':'1','consent':True,'faces':[{'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576} for _ in range(20)]}
        def gateway(path,method='GET',body=None,*args):
            if path.startswith('rpc/'):return True
            if 'eq.classes' in path:return [{'payload':{'name':'Our classroom'}}]
            if 'eq.students' in path:return []
            if method=='POST':return None
            return []
        with patch('eigenroll_server.shared.db',side_effect=gateway):
            self.assertEqual(self.post('/api/enroll?invite='+token,payload).status_code,201)
        def duplicate(path,method='GET',body=None,*args):
            if method=='POST' and path=='eigenroll_enrollments':raise GatewayError('Duplicate registration.',409)
            return gateway(path,method,body,*args)
        with patch('eigenroll_server.shared.db',side_effect=duplicate):
            self.assertEqual(self.post('/api/enroll?invite='+token,payload).status_code,409)
    def test_concurrent_teacher_change_returns_conflict(self):
        self.login()
        with patch('eigenroll_server.shared.db',return_value=[]):
            self.assertEqual(self.post('/api/workspace',{'id':'classes:c','kind':'classes','payload':{'name':'Class'},'revision':1}).status_code,409)
    def test_csrf_protects_submission_and_login(self):
        from django.test import Client
        client=Client(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/auth','{}',content_type='application/json').status_code,403)
        self.assertEqual(client.post('/api/enroll','{}',content_type='application/json').status_code,403)


    def test_direct_attendance_is_read_only_and_omits_enrollment_images(self):
        student={'id':'s','name':'Student','roll':'123','classId':'classroom','faces':[{'image':'private-photo','vector':[0.0]*576}]}
        self.assertEqual(self.client.get('/api/attendance').status_code,401)
        self.login()
        with patch('eigenroll_server.shared.db',return_value=[{'payload':student}]):
            r=self.client.get('/api/attendance');self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['rows'][0]['payload']['faces'][0]['image'],'')
        self.assertEqual(r['Cache-Control'],'no-store')
        self.assertEqual(self.client.get('/api/attendance?kind=sessions').status_code,400)
        self.assertEqual(self.post('/api/attendance',{}).status_code,405)
        self.client.cookies.clear()
        self.assertEqual(self.post('/api/workspace',{}).status_code,401)

    def test_enrollment_rejects_malformed_identity_features(self):
        token=signing.dumps({'classId':'classroom'},salt='enrollment')
        payload={'name':'Student','roll':'1','consent':True,'faces':[{'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576,'embedding':[0.0]*127} for _ in range(20)]}
        def gateway(path,*args):return True if path.startswith('rpc/') else [{'payload':{'name':'Our classroom'}}]
        with patch('eigenroll_server.shared.db',side_effect=gateway):
            self.assertEqual(self.post('/api/enroll?invite='+token,payload).status_code,400)

    def test_attendance_snapshot_is_compact_current_batch_and_includes_model(self):
        student={'id':'s','name':'Student','roll':'123','classId':'classroom','faces':[{'image':'private-photo','vector':[1.0]*576,'embedding':[1.0]*128}]*20}
        model={'rosterSignature':'s:20','identity':{'extractor':'faceapi-1.7.15-landmarks-v1'}}
        rows=[{'id':'students:s','kind':'students','payload':student},{'id':'models:classroom','kind':'models','payload':model}, {'id':'students:other','kind':'students','payload':{**student,'classId':'other'}}]
        self.login()
        with patch('eigenroll_server.shared.db',return_value=rows) as db:
            response=self.client.get('/api/attendance?kind=snapshot')
        self.assertEqual(response.status_code,200)
        self.assertEqual(db.call_count,1)
        snapshot=response.json()
        self.assertEqual(snapshot['models']['classroom'],model)
        self.assertEqual(len(snapshot['students']),1)
        self.assertEqual(len(snapshot['students'][0]['faces']),20)
        self.assertEqual(snapshot['students'][0]['faces'][0],{'image':'','vector':[]})
        self.assertNotContains(response,'private-photo')
        self.assertEqual(snapshot['sessions'],[])
        self.assertEqual(response['Cache-Control'],'no-store')
        self.assertLess(len(response.content),2000)

    def test_attendance_snapshot_pages_without_truncating_the_roster(self):
        student={'id':'s','name':'Student','roll':'123','classId':'classroom','faces':[]}
        row={'id':'students:s','kind':'students','payload':student}
        self.login()
        with patch('eigenroll_server.shared.db',side_effect=[[row]*100,[row]]) as db:
            response=self.client.get('/api/attendance?kind=snapshot')
        self.assertEqual(len(response.json()['students']),101)
        self.assertIn('offset=100',db.call_args.args[0])

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
