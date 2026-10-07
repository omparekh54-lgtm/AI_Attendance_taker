from django.http import JsonResponse
from django.core import signing
from .shared import enabled
from django.shortcuts import render
from django.views.decorators.http import require_GET

RUNTIME_CONFIG = {
    'framework': 'Django',
    'storage': 'browser-indexeddb',
    'recognition': 'browser-pca-lda',
    'minimumSamples': 5,
    'recommendedSamples': 20,
    'maximumSamples': 30,
    'minimumObservations': 2,
    'maximumVideoSeconds': 60,
}

def runtime():
    return {**RUNTIME_CONFIG, 'sharedStorage': enabled(), 'storage': 'shared-postgres' if enabled() else 'browser-indexeddb', 'defaultInvite': signing.dumps({'classId':'classroom'}, salt='enrollment',compress=True) if enabled() else ''}

@require_GET
def index(request):
    response = render(request, 'index.html', {'runtime_config': runtime()})
    response['Cache-Control'] = 'no-store'
    response['Permissions-Policy'] = 'camera=(self), microphone=()'
    return response

@require_GET
def health(request):
    return JsonResponse({'status': 'ok', 'framework': 'Django', 'storage': runtime()['storage'], 'server_database': enabled()})

@require_GET
def configuration(request):
    return JsonResponse(runtime())
