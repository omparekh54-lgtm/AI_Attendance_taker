"""Stateless Django application server; student data remains in the browser."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or secrets.token_urlsafe(64)
DEBUG = os.environ.get('DJANGO_DEBUG') == '1'
ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'testserver']
ALLOWED_HOSTS += [host.strip() for host in os.environ.get('DJANGO_ALLOWED_HOSTS', '').split(',') if host.strip()]
for key in ('VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL'):
    if os.environ.get(key):
        ALLOWED_HOSTS.append(os.environ[key])
INSTALLED_APPS = ['eigenroll_server.apps.EigenrollStaticFilesConfig']
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
ROOT_URLCONF = 'eigenroll_server.urls'
WSGI_APPLICATION = 'eigenroll_server.wsgi.application'
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [BASE_DIR / 'dist'], 'APP_DIRS': False, 'OPTIONS': {'context_processors': []}}]
DATABASES = {}  # No ephemeral SQLite database is used in serverless production.
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'dist'] if (BASE_DIR / 'dist').exists() else []
STORAGES = {'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'}}
WHITENOISE_MIMETYPES = {'.wasm': 'application/wasm', '.tflite': 'application/octet-stream'}
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = bool(os.environ.get('VERCEL'))
SECURE_HSTS_SECONDS = 31536000 if os.environ.get('VERCEL') else 0
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = bool(os.environ.get('VERCEL'))
X_FRAME_OPTIONS = 'DENY'
USE_TZ = True
TIME_ZONE = 'Asia/Kolkata'

DATA_UPLOAD_MAX_MEMORY_SIZE = 1000000
