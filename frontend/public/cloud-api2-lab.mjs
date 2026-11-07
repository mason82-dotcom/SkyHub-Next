// Standalone deterministic in-memory simulation. Never attached to real devices.
const FRAMES=Object.freeze([
  Object.freeze({phase:'Bereit',altitude:0,battery:96,link:100,note:'Fiktives Gerät initialisiert'}),
  Object.freeze({phase:'Steigflug (LAB)',altitude:15,battery:95,link:99,note:'Fiktive Telemetrie: Steigflug'}),
  Object.freeze({phase:'Wegpunkte (LAB)',altitude:55,battery:91,link:97,note:'Fiktive Wegpunktphase'}),
  Object.freeze({phase:'Rückkehr (LAB)',altitude:27,battery:86,link:98,note:'Fiktive Rückkehrphase'}),
  Object.freeze({phase:'Abgeschlossen',altitude:0,battery:85,link:100,note:'Simulation beendet; keine reale Mission'})
]);
class SkyHubLabSimulator {
  constructor(){this.reset();}
  current(){return {...FRAMES[this.index],index:this.index,count:FRAMES.length,synthetic:true};}
  reset(){this.index=0;this.history=[{index:0,...FRAMES[0]}];return this.current();}
  advance(){
    if(this.index<FRAMES.length-1)this.index++;
    this.history.push({index:this.index,...FRAMES[this.index]});
    return this.current();
  }
  exportData(){return {
    schema:'skyhub.cloudapi2.synthetic.v1',synthetic:true,hardwareVerified:false,flightReady:false,
    device:'LAB-DEVICE-01',events:this.history.map(x=>({...x}))
  };}
}
export {SkyHubLabSimulator,FRAMES};