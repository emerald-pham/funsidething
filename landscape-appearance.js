/* Stable visitor identities, independent of animation frames and event odds. */
(function(root){
  'use strict';
  const birds=Object.freeze(['#6597ad','#b27765','#a58b56','#8f85ac','#75986e','#b18e81','#6b9c99','#ab797c']);
  const hair=Object.freeze(['#302c2c','#614638','#9b6650','#c9ad74','#a6a29a','#914e37']);
  const styles=Object.freeze(['short','bob','long','bun','ponytail','curly','bald']);
  const unit=n=>((Number.isFinite(n)?n:0)%1+1)%1;
  const mix=(a,b,t)=>'#'+a.slice(1).match(/../g).map((v,i)=>Math.round(parseInt(v,16)*(1-t)+parseInt(b.slice(1+i*2,3+i*2),16)*t).toString(16).padStart(2,'0')).join('');
  function birdColor(seed,night=0,ambient='#23332f',proximity=0){
    const plumage=birds[Math.floor(unit(seed)*birds.length)];
    const ink=mix('#202b2d',plumage,.12+.88*Math.max(0,Math.min(1,proximity)));
    return mix(ink,ambient,Math.max(0,Math.min(1,night))*.55);
  }
  function person(seed){return {style:styles[Math.floor(unit(seed*13.17)*styles.length)],color:hair[Math.floor(unit(seed*7.31)*hair.length)]};}
  root.LandscapeAppearance=Object.freeze({birdColor,person});
})(globalThis);
