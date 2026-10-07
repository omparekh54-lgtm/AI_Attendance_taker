from django.http import JsonResponse
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

@require_GET
def index(request):
    response = render(request, 'index.html', {'runtime_config': RUNTIME_CONFIG})
    response['Cache-Control'] = 'no-store'
    response['Permissions-Policy'] = 'camera=(self), microphone=()'
    return response

@require_GET
def health(request):
    return JsonResponse({'status': 'ok', 'framework': 'Django', 'storage': 'browser-indexeddb', 'server_database': False})

@require_GET
def configuration(request):
    return JsonResponse(RUNTIME_CONFIG)
