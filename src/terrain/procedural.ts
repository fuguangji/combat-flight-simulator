/** Deterministic, coordinate-based terrain sampler; the world does not depend on loaded chunks. */
export interface TerrainSample { height: number; biome: 'plain' | 'ridge' | 'basin'; }
const fract=(v:number)=>v-Math.floor(v);
function hash(x:number,z:number,seed:number):number{return fract(Math.sin(x*127.1+z*311.7+seed*74.7)*43758.5453123);}
function smooth(t:number):number{return t*t*(3-2*t);}
function noise(x:number,z:number,seed:number):number{
  const ix=Math.floor(x),iz=Math.floor(z),fx=smooth(fract(x)),fz=smooth(fract(z));
  const a=hash(ix,iz,seed),b=hash(ix+1,iz,seed),c=hash(ix,iz+1,seed),d=hash(ix+1,iz+1,seed);
  const ab=a+(b-a)*fx,cd=c+(d-c)*fx;return ab+(cd-ab)*fz;
}
/** Infinite deterministic height field in metres, suitable for chunk generation and minimap sampling. */
export function sampleTerrain(x:number,z:number,seed=1337):TerrainSample{
  const broad=noise(x/12000,z/12000,seed)-.5;
  const medium=noise(x/3200,z/3200,seed+1)-.5;
  const fine=noise(x/650,z/650,seed+2)-.5;
  const ridge=1-Math.abs(noise(x/7000,z/7000,seed+3)*2-1);
  const height=Math.max(-180,Math.min(1850,broad*900+medium*420+fine*90+Math.pow(ridge,3)*420));
  return {height,biome:height>700?'ridge':height<80?'basin':'plain'};
}
