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
