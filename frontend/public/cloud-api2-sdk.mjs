// SkyHub-owned keyless read-only facade; NOT DJI's licensed Java/JNI SDK.
class SkyHubDaaSClient {
  constructor(options={}) {
    if (options.endpoint!==undefined && options.endpoint!=='/api/cloud-api2')
      throw new TypeError('Only the local SkyHub endpoint is allowed');
    this.fetchImpl=options.fetchImpl || fetch.bind(globalThis);
  }
  async query(resource) {
    if(!['status','devices','capabilities','evidence'].includes(resource)) throw new TypeError('Read-only operation required');
    const response=await this.fetchImpl('/api/cloud-api2/'+resource,{
      method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
    });
    if(!response || !response.ok) {
      const status=response&&Number.isInteger(response.status)?response.status:0;
      throw new Error(status===401?'SkyHub-Zugriff nicht freigegeben (HTTP 401)':'SkyHub nicht erreichbar (HTTP '+status+')');
    }
    return response.json();
  }
  getStatus(){return this.query('status');}
  listDevices(){return this.query('devices');}
  getCapabilities(){return this.query('capabilities');}
  getEvidence(){return this.query('evidence');}
}
export {SkyHubDaaSClient};