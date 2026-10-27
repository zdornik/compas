// One slow travelling wave, measured in units of the original inner pocket.
// Sampling towards the centre pushes the painted contour outwards. The inner
// pocket remains fixed, so neither the mascot nor its visual anchor drifts.
export const RADIATION = Object.freeze({
  period: 10.8,
  wavelength: 2.4,
  amplitude: .09,
  innerStart: .68,
  innerEnd: 1.25,
  outerStart: 5,
  outerEnd: 8,
  fadeIn: 1.4,
  framesPerSecond: 30,
});

export const radiationFragment = `
float easeRange(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec2 radiatingSource(vec2 source){
  vec2 anchor=vec2(503./971.,748./1619.);
  vec2 delta=source-anchor;
  vec2 pocket=delta*vec2(971./160.,1619./244.);
  float radius=length(pocket);
  float angle=atan(pocket.y,pocket.x+.00001);
  float envelope=easeRange(${RADIATION.innerStart},${RADIATION.innerEnd},radius)*(1.-easeRange(${RADIATION.outerStart}.,${RADIATION.outerEnd}.,radius));
  float crest=.5+.5*sin(radius*${(2 * Math.PI / RADIATION.wavelength).toFixed(9)}-wavePhase);
  // A slower, very small breath changes the whole mass, while individual
  // protrusions stretch in a different rhythm. The protected pocket is still.
  float breath=.012*sin(wavePhase*.25);
  float oval=.009*sin(wavePhase*.5+.4);
  float lobes=.008*sin(angle*3.+wavePhase*.5)*sin(radius*.7);
  float amount=waveStrength*envelope;
  vec2 flow=pocket*(vec2(1.)-amount*(vec2(${RADIATION.amplitude}*crest+breath+lobes)+vec2(oval,-oval*.75)));
  float twist=.007*sin(wavePhase*.25)*amount;
  flow=mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*flow;
  return anchor+flow/vec2(971./160.,1619./244.);
}`;
