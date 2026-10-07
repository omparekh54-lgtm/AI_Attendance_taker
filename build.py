"""Build the browser client, Django template, and deployable static assets."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
subprocess.run(['npm', 'ci'], cwd=root, check=True)
subprocess.run(['npm', 'run', 'build'], cwd=root, check=True)
index = root / 'dist' / 'index.html'
html = index.read_text()
marker = '<!--eigenroll-runtime-->'
if marker not in html:
    raise RuntimeError('Django runtime marker missing from frontend template')
index.write_text(html.replace(marker, '{{ runtime_config|json_script:"eigenroll-config" }}'))
subprocess.run(['python', 'manage.py', 'collectstatic', '--noinput', '--ignore=index.html'], cwd=root, check=True)
