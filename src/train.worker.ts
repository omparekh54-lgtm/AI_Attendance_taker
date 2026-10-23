import {buildModel} from './build-model';
self.onmessage = e => {
  try { self.postMessage({model: buildModel(e.data.students, e.data.signature, e.data.classroom ?? [])}); }
  catch (error) { self.postMessage({error: (error as Error).message}); }
};
