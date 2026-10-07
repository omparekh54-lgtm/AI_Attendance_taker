"""Run locally, never as part of the production build. Requires sklearn, numpy, Pillow."""
import json, sys
import numpy as np
from PIL import Image
from sklearn.datasets import fetch_olivetti_faces
faces=fetch_olivetti_faces()
rows=[]
for image,label in zip(faces.images,faces.target):
    vector=np.asarray(Image.fromarray(image).resize((24,24),Image.Resampling.BILINEAR)).reshape(-1)
    vector=(vector-vector.mean())/max(vector.std(),.05)
    rows.append({'label':str(int(label)),'vector':vector.tolist()})
with open(sys.argv[1],'w') as output:json.dump(rows,output)
print(f'Prepared {len(rows)} vectors. Run: node --import tsx scripts/benchmark.ts {sys.argv[1]}')
