"""Django-only persistence gateway. No database credential reaches the browser."""
import json, os, hashlib, time, math, uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from django.core import signing
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.crypto import constant_time_compare

class GatewayError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message); self.status=status

def enabled():
    return all(os.environ.get(k) for k in ('SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','EIGENROLL_SERVER_TOKEN','EIGENROLL_TEACHER_PASSWORD','DJANGO_SECRET_KEY'))

def db(path, method='GET', body=None, prefer=None):
    if not enabled(): raise GatewayError('Shared registration is awaiting server configuration.')
    headers={'apikey':os.environ['SUPABASE_PUBLISHABLE_KEY'],'x-eigenroll-server':os.environ['EIGENROLL_SERVER_TOKEN'],'Content-Type':'application/json'}
    if prefer: headers['Prefer']=prefer
    req=Request(os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/'+path,data=json.dumps(body,allow_nan=False).encode() if body is not None else None,headers=headers,method=method)
    try:
        with urlopen(req,timeout=15) as r:
            raw=r.read(); return json.loads(raw) if raw else None
    except HTTPError as e:
        if e.code==409: raise GatewayError('This roll number has already submitted a registration.',409)
        raise GatewayError('Shared storage could not complete this request.') from e
    except (URLError,TimeoutError) as e: raise GatewayError('Shared storage is temporarily unavailable. Please retry.') from e

def query(table,**params): return table+'?'+urlencode(params)
def teacher(request):
    try: return signing.loads(request.COOKIES.get('eigenroll_teacher',''),salt='teacher',max_age=8*3600)=='teacher'
    except signing.BadSignature: return False

def data(request):
    if len(request.body)>900000: raise GatewayError('Submission is too large. Use at most 30 face samples.',413)
    try:
        result=json.loads(request.body)
        if not isinstance(result,dict): raise ValueError()
        return result
    except (ValueError,UnicodeDecodeError): raise GatewayError('Invalid submission.',400)

def protected(fn):
    def wrapped(request,*args,**kwargs):
        try:
            if not enabled(): raise GatewayError('Shared registration is awaiting server configuration.')
            return fn(request,*args,**kwargs)
        except GatewayError as e: return JsonResponse({'error':str(e)},status=e.status)
        except (ValueError,TypeError,KeyError): return JsonResponse({'error':'Invalid request.'},status=400)
    return wrapped

def limit(request,category,maximum):
    # Vercel's trusted edge address; hash it so no raw IP is stored.
    ip=request.META.get('HTTP_X_VERCEL_FORWARDED_FOR') or request.META.get('REMOTE_ADDR','unknown')
    bucket=category+':'+hashlib.sha256(ip.encode()).hexdigest()+':'+str(int(time.time()//3600))
    if not db('rpc/eigenroll_consume_limit','POST',{'bucket':bucket,'maximum':maximum}): raise GatewayError('Too many attempts. Please try again next hour.',429)

@ensure_csrf_cookie
@require_http_methods(['GET','POST','DELETE'])
def authentication(request):
    if request.method=='GET': return JsonResponse({'teacher':teacher(request),'shared':enabled()})
    if request.method=='DELETE':
        r=JsonResponse({'teacher':False});r.delete_cookie('eigenroll_teacher');return r
    try:
        if not enabled(): raise GatewayError('Teacher sign-in is awaiting server configuration.')
        limit(request,'login',20)
        if not constant_time_compare(str(data(request).get('password','')),os.environ['EIGENROLL_TEACHER_PASSWORD']): raise GatewayError('Incorrect teacher access key.',401)
        r=JsonResponse({'teacher':True});r.set_cookie('eigenroll_teacher',signing.dumps('teacher',salt='teacher'),max_age=8*3600,httponly=True,secure=bool(os.environ.get('VERCEL')),samesite='Strict');return r
    except GatewayError as e: return JsonResponse({'error':str(e)},status=e.status)

@require_http_methods(['GET','POST','DELETE'])
@protected
def workspace(request):
    if not teacher(request): raise GatewayError('Teacher sign-in required.',401)
    if request.method=='GET':
        kind=request.GET.get('kind','classes')
        if kind not in ('classes','students','sessions','models'): raise ValueError()
        offset=max(0,int(request.GET.get('offset',0)))
        return JsonResponse({'rows':db(query('eigenroll_entities',kind='eq.'+kind,select='id,payload,revision',order='id',limit=5,offset=offset))})
    d=data(request); ident=str(d['id']);kind=d['kind']
    if kind not in ('classes','students','sessions','models') or len(ident)>200: raise ValueError()
    if request.method=='DELETE':
        rows=db(query('eigenroll_entities',id='eq.'+ident,revision='eq.'+str(int(d['revision']))),'DELETE',prefer='return=representation')
        if not rows: raise GatewayError('This record changed on another device. Refresh before deleting.',409)
        return JsonResponse({'ok':True})
    revision=d.get('revision');payload=d['payload']
    if not isinstance(payload,dict):raise ValueError()
    if revision:
        rows=db(query('eigenroll_entities',id='eq.'+ident,revision='eq.'+str(int(revision))),'PATCH',{'payload':payload,'revision':int(revision)+1,'updated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},'return=representation')
        if not rows: raise GatewayError('This record changed on another device. Refresh before saving.',409)
    else:
        rows=db('eigenroll_entities','POST',{'id':ident,'kind':kind,'payload':payload},'return=representation')
    return JsonResponse({'revision':rows[0]['revision']})

@require_http_methods(['GET','POST','DELETE'])
@protected
def enrollments(request):
    if not teacher(request): raise GatewayError('Teacher sign-in required.',401)
    if request.method=='GET':
        return JsonResponse({'rows':db(query('eigenroll_enrollments',select='*',order='created_at',limit=5,offset=max(0,int(request.GET.get('offset',0)))))})
    d=data(request)
    if request.method=='POST':
        class_id=d['classId']; rows=db(query('eigenroll_entities',id='eq.classes:'+class_id,kind='eq.classes',select='payload'))
        if not rows: raise GatewayError('Create and save the class first.',404)
        return JsonResponse({'invite':signing.dumps({'classId':class_id},salt='enrollment',compress=True)})
    uuid.UUID(d['id']);db(query('eigenroll_enrollments',id='eq.'+d['id']),'DELETE');return JsonResponse({'ok':True})

@require_http_methods(['GET','POST'])
@protected
def enrollment(request):
    token=request.GET.get('invite','')
    try: invite=signing.loads(token,salt='enrollment',max_age=30*24*3600)
    except signing.BadSignature:raise GatewayError('This class link is invalid or expired. Ask your teacher for a new link.',400)
    classes=db(query('eigenroll_entities',id='eq.classes:'+invite['classId'],kind='eq.classes',select='payload'))
    if not classes: raise GatewayError('This class is no longer accepting registrations.',404)
    if request.method=='GET': return JsonResponse({'classId':invite['classId'],'className':classes[0]['payload']['name']})
    limit(request,'enrollment',30);d=data(request)
    if d.get('consent') is not True:raise GatewayError('Please confirm your permission to register your face samples.',400)
    name=d.get('name','');roll=d.get('roll','');faces=d.get('faces')
    if not isinstance(name,str) or not isinstance(roll,str) or not 1<=len(name.strip())<=100 or not 1<=len(roll.strip())<=40:raise GatewayError('Enter a full name and roll number.',400)
    if not isinstance(faces,list) or not 20<=len(faces)<=30:raise GatewayError('Collect 20–30 accepted face samples.',400)
    for f in faces:
        if not isinstance(f,dict) or not isinstance(f.get('image'),str) or not f['image'].startswith('data:image/jpeg;base64,') or len(f['image'])>30000: raise GatewayError('Invalid face image.',400)
        v=f.get('vector')
        if not isinstance(v,list) or len(v)!=576 or any(type(x) not in (float,int) or not math.isfinite(x) or abs(x)>25 for x in v):raise GatewayError('Invalid face sample.',400)
    students=db(query('eigenroll_entities',kind='eq.students',select='payload',**{'payload->>classId':'eq.'+invite['classId'],'payload->>roll':'eq.'+roll.strip()}))
    if students: raise GatewayError('This roll number is already enrolled. Contact your teacher for updates.',409)
    record={'id':str(uuid.uuid4()),'classId':invite['classId'],'name':name.strip(),'roll':roll.strip(),'faces':faces}
    db('eigenroll_enrollments','POST',{'class_id':invite['classId'],'roll':roll.strip(),'payload':record})
    return JsonResponse({'ok':True,'message':'Submitted for teacher review. You can close this page.'},status=201)
