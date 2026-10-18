import json,os,uuid
from unittest.mock import patch
from django.core import signing
from django.test import SimpleTestCase,Client
from .test_shared import ENV

@patch.dict(os.environ,ENV)
class PhoneCaptureTests(SimpleTestCase):
    def setUp(self):
        self.ident=str(uuid.uuid4());self.token=signing.dumps({'id':self.ident},salt='phone-capture')
        self.path='/api/phone-capture?token='+self.token
        self.session={'id':self.ident,'expires_at':'2099-01-01T00:00:00Z','payload':None}
    def post(self,path,payload):return self.client.post(path,json.dumps(payload),content_type='application/json')
    def sign_in(self):self.client.cookies['eigenroll_teacher']=signing.dumps('teacher',salt='teacher')
    def test_board_pairing_needs_no_teacher_key_but_is_owner_scoped(self):
        with patch('eigenroll_server.capture.limit'),patch('eigenroll_server.capture.db'):
            r=self.post('/api/capture-session',{});self.assertEqual(r.status_code,201)
        self.assertTrue(r.cookies['eigenroll_board']['httponly'])
        with patch('eigenroll_server.capture.db',return_value=[self.session]):
            self.assertEqual(self.client.get('/api/capture-session',{'id':self.ident}).status_code,403)
        for method in ('get','delete'):
            self.assertEqual(getattr(Client(),method)('/api/capture-session?id='+self.ident).status_code,401)
    def test_phone_token_does_not_grant_roster_access(self):
        with patch('eigenroll_server.capture.db',return_value=[self.session]):
            r=self.client.get(self.path);self.assertEqual(r.status_code,200)
            self.assertEqual(set(r.json()),{'batch','waiting'});self.assertEqual(r['Cache-Control'],'no-store')
        self.assertEqual(self.client.get('/api/workspace?token='+self.token).status_code,401)
    def test_invalid_expired_and_closed_phone_links_rejected(self):
        self.assertEqual(self.client.get('/api/phone-capture?token=forged').status_code,410)
        with patch('django.core.signing.time.time',return_value=10**11):self.assertEqual(self.client.get(self.path).status_code,410)
        with patch('eigenroll_server.capture.db',return_value=[]):self.assertEqual(self.client.get(self.path).status_code,410)
    def test_phone_accepts_valid_faces_and_does_not_overwrite_unreceived_photo(self):
        payload={'faces':[{'face':{'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576},'usable':True}]}
        with patch('eigenroll_server.capture.limit'),patch('eigenroll_server.capture.db',side_effect=[[self.session],[self.session]]):
            self.assertEqual(self.post(self.path,payload).status_code,200)
        with patch('eigenroll_server.capture.limit'),patch('eigenroll_server.capture.db',side_effect=[[self.session],[]]):
            self.assertEqual(self.post(self.path,payload).status_code,409)
    def test_phone_rejects_invalid_vectors_and_excess_faces(self):
        for faces in ([],[{}]*41,[{'face':{'image':'data:image/jpeg;base64,eA==','vector':[0.0]*575},'usable':True}],[{'face':[],'usable':True}]):
            with patch('eigenroll_server.capture.limit'),patch('eigenroll_server.capture.db',return_value=[self.session]):
                self.assertEqual(self.post(self.path,{'faces':faces}).status_code,400)
    def test_acknowledgement_is_scoped_to_the_frame_and_session(self):
        self.sign_in()
        with patch('eigenroll_server.capture.db',return_value=[self.session]) as db:
            r=self.post('/api/capture-session',{'action':'ack','id':self.ident,'frameId':'frame-a'})
            self.assertEqual(r.status_code,200);self.assertIn('payload-%3E%3Eid=eq.frame-a',db.call_args.args[0]);self.assertEqual(db.call_args.args[2],{'payload':None})
    def test_phone_posts_require_csrf(self):
        c=Client(enforce_csrf_checks=True)
        self.assertEqual(c.post(self.path,'{}',content_type='application/json').status_code,403)


    def test_phone_rejects_malformed_identity_descriptors(self):
        face={'face':{'image':'data:image/jpeg;base64,eA==','vector':[0.0]*576,'embedding':[0.0]*127},'usable':True}
        with patch('eigenroll_server.capture.limit'),patch('eigenroll_server.capture.db',return_value=[self.session]):
            self.assertEqual(self.post(self.path,{'faces':[face]}).status_code,400)
