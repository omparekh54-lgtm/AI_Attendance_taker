"""Short-lived phone-to-board relay. A phone capability never grants roster access."""
import hashlib, math, secrets, time, uuid
from django.core import signing
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from .shared import db, query, teacher, data, protected, GatewayError, limit

def now(): return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def response(payload,status=200):
    result=JsonResponse(payload,status=status);result['Cache-Control']='no-store';return result

def active(ident):
    uuid.UUID(ident)
    rows=db(query('eigenroll_capture_sessions',id='eq.'+ident,expires_at='gt.'+now(),select='id,payload,expires_at'))
    if not rows: raise GatewayError('This phone connection has expired or was closed. Scan a new QR code.',410)
    return rows[0]

@require_http_methods(['GET','POST','DELETE'])
@protected
def board(request):
    def check_owner(ident):
        if teacher(request): return
        try: owner=signing.loads(request.COOKIES.get('eigenroll_board',''),salt='board-owner',max_age=900)
        except signing.BadSignature: raise GatewayError('Create a new phone connection on this board.',401)
        if owner!=ident: raise GatewayError('This phone connection belongs to another board.',403)
    if request.method=='POST':
        d=data(request)
        if d.get('action')=='ack':
            ident=str(d['id']);check_owner(ident);active(ident)
            db(query('eigenroll_capture_sessions',id='eq.'+ident,**{'payload->>id':'eq.'+str(d['frameId'])}),'PATCH',{'payload':None})
            return response({'ok':True})
        limit(request,'pair',30)
        db(query('eigenroll_capture_sessions',expires_at='lt.'+now()),'DELETE')
        ident=str(uuid.uuid4());expires=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()+900))
        db('eigenroll_capture_sessions','POST',{'id':ident,'expires_at':expires})
        token=signing.dumps({'id':ident,'nonce':secrets.token_urlsafe(24)},salt='phone-capture')
        result=response({'id':ident,'token':token,'expiresAt':expires},201)
        result.set_cookie('eigenroll_board',signing.dumps(ident,salt='board-owner'),max_age=900,httponly=True,secure=request.is_secure(),samesite='Strict')
        return result
    ident=request.GET.get('id','');check_owner(ident)
    if request.method=='DELETE':
        uuid.UUID(ident);db(query('eigenroll_capture_sessions',id='eq.'+ident),'DELETE');return response({'ok':True})
    return response(active(ident))

@ensure_csrf_cookie
@require_http_methods(['GET','POST'])
@protected
def phone(request):
    try: ident=signing.loads(request.GET.get('token',''),salt='phone-capture',max_age=900)['id']
    except (signing.BadSignature,KeyError):raise GatewayError('Invalid or expired phone link. Scan a new QR code.',410)
    row=active(ident)
    if request.method=='GET':return response({'batch':'BTI DS 2022 - 28','waiting':row.get('payload') is not None})
    limit(request,'phone-capture',120)
    d=data(request);faces=d.get('faces')
    if not isinstance(faces,list) or not 1<=len(faces)<=40:raise GatewayError('Send 1–40 faces per capture. Capture smaller classroom sections.',400)
    for item in faces:
        if not isinstance(item,dict) or type(item.get('usable')) is not bool:raise ValueError()
        face=item.get('face',{})
        if not isinstance(face,dict):raise ValueError()
        vector=face.get('vector',[]);image=face.get('image','')
        if not isinstance(image,str) or not image.startswith('data:image/jpeg;base64,') or len(image)>30000:raise ValueError()
        if not isinstance(vector,list) or len(vector)!=576 or any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>25 for v in vector):raise ValueError()
    payload={'id':str(uuid.uuid4()),'faces':[{'face':x['face'],'usable':x['usable']} for x in faces]}
    rows=db(query('eigenroll_capture_sessions',id='eq.'+ident,expires_at='gt.'+now(),payload='is.null'),'PATCH',{'payload':payload},'return=representation')
    if not rows:raise GatewayError('The board is still receiving the previous photo. Wait a moment and try again.',409)
    return response({'ok':True,'faces':len(faces)})

