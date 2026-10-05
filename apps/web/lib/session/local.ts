import { LocalTransport as SharedLocalTransport, type TransportEvents } from '@city/client';
import { loadDemoData } from '../local/demo-data';

/** "Offline demo mode": the core pipeline runs in this tab over fixture data (D-005). Shared implementation: @city/client. */
export class LocalTransport extends SharedLocalTransport {
  constructor(ev: TransportEvents) {
    super(ev, loadDemoData, 'Core pipeline running in this browser over fixture data');
  }
}
