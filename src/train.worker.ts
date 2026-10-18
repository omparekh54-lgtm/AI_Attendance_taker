import {train} from './model';import {trainIdentity,compactModel} from './identity';
self.onmessage=e=>{try{
 if(Array.isArray(e.data)){self.postMessage({model:train(e.data)});return}
 const {samples,identitySamples,signature}=e.data;
 self.postMessage({model:compactModel({...train(samples),identity:trainIdentity(identitySamples),rosterSignature:signature})});
}catch(error){self.postMessage({error:(error as Error).message})}};
