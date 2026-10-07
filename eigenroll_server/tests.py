import json
from pathlib import Path
from django.conf import settings
from django.test import SimpleTestCase

class ApplicationTests(SimpleTestCase):
    def test_health_identifies_real_django_server_and_local_storage(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['framework'], 'Django')
        self.assertFalse(response.json()['server_database'])

    def test_configuration_is_read_only(self):
        self.assertEqual(self.client.get('/api/config').json()['minimumObservations'], 2)
        self.assertEqual(self.client.post('/api/config', {}).status_code, 405)
        self.assertEqual(self.client.post('/api/health', {}).status_code, 405)

    def test_home_is_django_rendered_with_safe_runtime_configuration(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="eigenroll-config"')
        self.assertContains(response, '"framework": "Django"')
        self.assertNotContains(response, '{{ runtime_config')
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(response['X-Frame-Options'], 'DENY')
        self.assertEqual(response['Permissions-Policy'], 'camera=(self), microphone=()')
        self.assertContains(response, '/static/assets/')

    def test_assets_are_collected_with_required_wasm_and_model(self):
        self.assertTrue((Path(settings.STATIC_ROOT) / 'models' / 'face-detector.tflite').is_file())
        self.assertTrue((Path(settings.STATIC_ROOT) / 'wasm' / 'vision_wasm_internal.wasm').is_file())
        self.assertFalse((Path(settings.STATIC_ROOT) / 'index.html').exists())

    def test_unknown_routes_do_not_leak_application_files(self):
        self.assertEqual(self.client.get('/eigenroll_server/settings.py').status_code, 404)
        self.assertEqual(self.client.get('/api/missing').status_code, 404)
