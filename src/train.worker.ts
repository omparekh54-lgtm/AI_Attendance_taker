import {train} from './model';self.onmessage=e=>{try{self.postMessage({model:train(e.data)})}catch(error){self.postMessage({error:(error as Error).message})}};
