"""Django-only persistence gateway. No database credential reaches the browser."""
import json, os, hashlib, time, math, uuid, gzip
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
    headers={'apikey':os.environ['SUPABASE_PUBLISHABLE_KEY'],'x-eigenroll-server':os.environ['EIGENROLL_SERVER_TOKEN'],'Content-Type':'application/json','Accept-Encoding':'gzip'}
    if prefer: headers['Prefer']=prefer
    req=Request(os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/'+path,data=json.dumps(body,allow_nan=False).encode() if body is not None else None,headers=headers,method=method)
    try:
        with urlopen(req,timeout=15) as r:
            raw=r.read()
            if r.headers.get('Content-Encoding')=='gzip':raw=gzip.decompress(raw)
            return json.loads(raw) if raw else None
    except HTTPError as e:
        if e.code==409: raise GatewayError('This SAP ID has already submitted a registration.',409)
        raise GatewayError('Shared storage could not complete this request.') from e
    except (URLError,TimeoutError) as e: raise GatewayError('Shared storage is temporarily unavailable. Please retry.') from e

def query(table,**params): return table+'?'+urlencode(params)
def valid_features(v): return isinstance(v,list) and len(v)==128 and all(type(x) in (float,int) and math.isfinite(x) and abs(x)<=5 for x in v)
r5=lambda v:[round(x,5) for x in v]
SESSION_SECONDS=8*3600
REMEMBER_SECONDS=30*24*3600
def teacher(request):
    # 'teacher' is an 8-hour session; 'teacher:remember' keeps a classroom smartboard signed in for 30 days.
    cookie=request.COOKIES.get('eigenroll_teacher','')
    try:
        value=signing.loads(cookie,salt='teacher',max_age=REMEMBER_SECONDS)
        if value=='teacher:remember': return True
        return value=='teacher' and signing.loads(cookie,salt='teacher',max_age=SESSION_SECONDS)=='teacher'
    except signing.BadSignature: return False

def data(request,max_bytes=900000,too_large='Submission is too large. Use at most 30 face samples.'):
    if len(request.body)>max_bytes: raise GatewayError(too_large,413)
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
        body=data(request)
        if not constant_time_compare(str(body.get('password','')),os.environ['EIGENROLL_TEACHER_PASSWORD']): raise GatewayError('Incorrect teacher access key.',401)
        remember=body.get('remember') is True
        r=JsonResponse({'teacher':True});r.set_cookie('eigenroll_teacher',signing.dumps('teacher:remember' if remember else 'teacher',salt='teacher'),max_age=REMEMBER_SECONDS if remember else SESSION_SECONDS,httponly=True,secure=bool(os.environ.get('VERCEL')),samesite='Strict');return r
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
    # Teacher saves include the recognition model (about 1.7 MB for a class of 26 with the class-style gallery).
    d=data(request,3_000_000,'This record is too large to save. Contact the developer.'); ident=str(d['id']);kind=d['kind']
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
    # A whole class may register from one college Wi-Fi address.
    limit(request,'enrollment',150);d=data(request)
    if d.get('consent') is not True:raise GatewayError('Please confirm your permission to register your face samples.',400)
    name=d.get('name','');roll=d.get('roll','');faces=d.get('faces')
    if not isinstance(name,str) or not isinstance(roll,str) or not 1<=len(name.strip())<=100 or not 1<=len(roll.strip())<=40:raise GatewayError('Enter a full name and SAP ID.',400)
    if not isinstance(faces,list) or not 20<=len(faces)<=30:raise GatewayError('Collect 20–30 accepted face samples.',400)
    for f in faces:
        if not isinstance(f,dict) or not isinstance(f.get('image'),str) or not f['image'].startswith('data:image/jpeg;base64,') or len(f['image'])>30000: raise GatewayError('Invalid face image.',400)
        v=f.get('vector')
        if not isinstance(v,list) or len(v)!=576 or any(type(x) not in (float,int) or not math.isfinite(x) or abs(x)>25 for x in v):raise GatewayError('Invalid face sample.',400)
        embedding=f.get('embedding')
        if not valid_features(embedding):raise GatewayError('Face features are missing. Refresh the page and take the samples again.',400)
    classroom=d.get('classroom',[])
    if not isinstance(classroom,list) or len(classroom)>8 or not all(valid_features(v) for v in classroom):raise GatewayError('Invalid classroom features.',400)
    students=db(query('eigenroll_entities',kind='eq.students',select='payload',**{'payload->>classId':'eq.'+invite['classId'],'payload->>roll':'eq.'+roll.strip()}))
    if students: raise GatewayError('This SAP ID is already registered. Contact your teacher if your details need to change.',409)
    ident=str(uuid.uuid4())
    record={'id':ident,'classId':invite['classId'],'name':name.strip(),'roll':roll.strip(),'faces':faces,'classroom':classroom,
            'registeredAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    # Registered students join the attendance roster immediately; the board builds its model from the roster.
    db('eigenroll_entities','POST',{'id':'students:'+ident,'kind':'students','payload':record})
    return JsonResponse({'ok':True,'message':'You are registered. Your attendance can be taken from the next class photo.'},status=201)


@ensure_csrf_cookie
@require_http_methods(['GET'])
@protected
def attendance(request):
    """Current roster for the attendance board: names, SAP IDs and face features. Enrolment photos never leave the server."""
    if request.GET.get('kind','snapshot')!='snapshot': raise ValueError()
    students=[];offset=0
    while True:
        rows=db(query('eigenroll_entities',select='payload',order='id',limit=100,offset=offset,kind='eq.students',**{'payload->>classId':'eq.classroom'}))
        for row in rows:
            p=row['payload']
            students.append({k:p[k] for k in ('id','name','roll','classId')}|{
                'faces':[{'image':'','vector':[],**({'embedding':r5(f['embedding'])} if f.get('embedding') else {})} for f in p.get('faces',[])],
                'classroom':[r5(v) for v in p.get('classroom',[])]})
        if len(rows)<100:break
        offset+=100
    result=JsonResponse({'classes':[{'id':'classroom','name':'BTI DS 2022 - 28'}],'students':students,'models':{},'sessions':[]},json_dumps_params={'separators':(',',':')})
    result['Cache-Control']='no-store'
    return result
