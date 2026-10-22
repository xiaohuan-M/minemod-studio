// Orthographic cube preview. Display angles are editor views, not game poses.
export function modelPreview(canvas){
  const ctx=canvas.getContext('2d');let model={elements:[]},yaw=.65,pitch=-.35,scale=8,last=null;
  const rotate=(p,axis,angle,origin=[0,0,0])=>{const v=p.map((n,i)=>n-origin[i]),a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),[i,j]=axis==='x'?[1,2]:axis==='y'?[2,0]:[0,1];const q=[...v];q[i]=v[i]*c-v[j]*s;q[j]=v[i]*s+v[j]*c;return q.map((n,i)=>n+origin[i]);};
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#eef2e8';ctx.fillRect(0,0,canvas.width,canvas.height);
    const project=p=>{const [x,y,z]=p.map(n=>n-8),a=x*Math.cos(yaw)+z*Math.sin(yaw),b=z*Math.cos(yaw)-x*Math.sin(yaw),c=y*Math.cos(pitch)-b*Math.sin(pitch),d=y*Math.sin(pitch)+b*Math.cos(pitch);return [canvas.width/2+a*scale,canvas.height/2-c*scale,d];};
    const faces=[];for(const e of model.elements){
      let points=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p=>p.map((v,i)=>v?e.to[i]:e.from[i]));
      if(e.rotation)points=points.map(p=>rotate(p,e.rotation.axis,e.rotation.angle,e.rotation.origin));points=points.map(project);
      [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[1,5,6,2],[0,3,7,4]].forEach((ids,i)=>faces.push({points:ids.map(j=>points[j]),depth:ids.reduce((sum,j)=>sum+points[j][2],0)/4,color:['#9b7fc3','#b39ad5','#65517f','#d0bee6','#8b71af','#ad94cc'][i]}));
    }
    for(const f of faces.sort((a,b)=>a.depth-b.depth)){ctx.beginPath();f.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=f.color;ctx.fill();ctx.strokeStyle='#58476e';ctx.lineWidth=1;ctx.stroke();}
    ctx.fillStyle='#62715c';ctx.font='12px sans-serif';ctx.fillText(model.elements.length+' cubes · 拖动旋转',12,canvas.height-12);
  }
  canvas.addEventListener('pointerdown',e=>{last=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!last)return;yaw+=(e.clientX-last[0])*.01;pitch+=(e.clientY-last[1])*.01;last=[e.clientX,e.clientY];draw();});
  for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,()=>last=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(2,Math.min(18,scale*(e.deltaY>0?.9:1.1)));draw();},{passive:false});
  return {set(value){model=value;draw();},view(value){[yaw,pitch]=({orbit:[.65,-.35],hand:[-.8,-.6],head:[0,-.2],front:[0,0]})[value]??[.65,-.35];draw();}};
}
