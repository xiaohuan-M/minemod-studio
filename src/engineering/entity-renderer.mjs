/** Fixed renderer templates. Kept outside the AI-editable source namespace. */
export function entityRendererSource(modId, { official = false, legacy = false } = {}) {
  const pkg = 'studio.minemod.runtime.m_' + modId;
  const matrix = official
      ? 'com.mojang.blaze3d.vertex.PoseStack'
      : 'net.minecraft.client.util.math.MatrixStack',
    entity = official
      ? 'net.minecraft.world.entity.LivingEntity'
      : 'net.minecraft.entity.LivingEntity',
    renderer = official
      ? 'net.minecraft.client.renderer.entity.EntityRenderer'
      : 'net.minecraft.client.render.entity.EntityRenderer',
    context = official
      ? 'net.minecraft.client.renderer.entity.EntityRendererProvider.Context'
      : 'net.minecraft.client.render.entity.EntityRendererFactory.Context',
    consumer = official
      ? 'com.mojang.blaze3d.vertex.VertexConsumer'
      : 'net.minecraft.client.render.VertexConsumer',
    buffers = official
      ? 'net.minecraft.client.renderer.MultiBufferSource'
      : 'net.minecraft.client.render.VertexConsumerProvider',
    id = official ? 'net.minecraft.resources.ResourceLocation' : 'net.minecraft.util.Identifier',
    idOf = official
      ? legacy
        ? 'new TextureId'
        : 'TextureId.fromNamespaceAndPath'
      : 'TextureId.of',
    push = official ? 'pushPose' : 'push',
    pop = official ? 'popPose' : 'pop',
    rotate = official ? 'mulPose' : 'multiply',
    position = official ? 'matrices.last().pose()' : 'matrices.peek().getPositionMatrix()',
    normal = official ? 'matrices.last().normal()' : 'matrices.peek().getNormalMatrix()',
    vertex = official ? (legacy ? 'vertex' : 'addVertex') : 'vertex',
    color = official && !legacy ? 'setColor' : 'color',
    uv = official ? (legacy ? 'uv' : 'setUv') : 'texture',
    overlay = official ? (legacy ? 'overlayCoords' : 'setOverlay') : 'overlay',
    light = official ? (legacy ? 'uv2' : 'setLight') : 'light',
    normalMethod = official && !legacy ? 'setNormal' : 'normal',
    end = legacy ? (official ? '.endVertex()' : '.next()') : '';
  // Java has no import aliases; the template uses simple names via replacement.
  const text = `package ${pkg};
import com.google.gson.Gson;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.joml.Quaternionf;
import org.joml.Vector3f;
import ${matrix};
import ${entity};
import ${renderer};
import ${consumer};
import ${buffers};
import ${id};
/** Original fixed cuboid renderer, MIT. Data is generated from validated assets. */
public final class StudioEntityRenderer<T extends LivingEntity> extends EntityRenderer<T> {
  private static final float RAD=(float)(Math.PI/180);
  private final TextureId texture;
  private final Mesh mesh;
  private final Track[] tracks;
  public StudioEntityRenderer(${context} context,String entityId) {
    super(context);
    texture=${idOf}("${modId}","textures/entity/"+entityId+".png");
    String path="/assets/minemod_runtime_m_${modId}/entity/"+entityId+".json";
    try(var stream=StudioEntityRenderer.class.getResourceAsStream(path)) {
      if(stream==null)throw new IllegalStateException("Missing original model resource");
      mesh=new Gson().fromJson(new InputStreamReader(stream,StandardCharsets.UTF_8),Mesh.class);
    }catch(Exception error){throw new IllegalStateException("Cannot load model "+entityId,error);}
    tracks=new Track[mesh.bones.length];
    if(mesh.clip!=null)for(Track track:mesh.clip.tracks)tracks[track.bone]=track;
    shadowRadius=.5f;
  }
  @Override public TextureId ${official ? 'getTextureLocation' : 'getTexture'}(T entity){return texture;}
  @Override public boolean shouldRender(T entity,${official ? 'net.minecraft.client.renderer.culling.Frustum' : 'net.minecraft.client.render.Frustum'} frustum,double x,double y,double z){
    double r=mesh.radius;
    if(!entity.shouldRender(x,y,z))return false;
    return super.shouldRender(entity,frustum,x,y,z)||frustum.isVisible(new ${official ? 'net.minecraft.world.phys.AABB' : 'net.minecraft.util.math.Box'}(entity.getX()-r,entity.getY()-r,entity.getZ()-r,entity.getX()+r,entity.getY()+r,entity.getZ()+r));
  }
  @Override public void render(T entity,float yaw,float delta,MatrixType matrices,BuffersType buffers,int light){
    if(!entity.isInvisible()){
      matrices.${push}();matrices.${rotate}(new Quaternionf().rotationY((180-yaw)*RAD));
      VertexConsumer output=buffers.getBuffer(${official ? 'net.minecraft.client.renderer.RenderType.entityCutoutNoCull' : 'net.minecraft.client.render.RenderLayer.getEntityCutoutNoCull'}(texture));
      float seconds=(entity.${official ? 'tickCount' : 'age'}+delta)/20f;
      boolean play=mesh.clip!=null&&(!"walk".equals(mesh.clip.name)||entity.${official ? 'getDeltaMovement().horizontalDistanceSqr()' : 'getVelocity().horizontalLengthSquared()'}>0.00001);
      for(int i=0;i<mesh.bones.length;i++)if(mesh.bones[i].parent<0)bone(i,seconds,play,matrices,output,light);
      matrices.${pop}();
    }
    super.render(entity,yaw,delta,matrices,buffers,light);
  }
  private void bone(int index,float seconds,boolean play,MatrixType matrices,VertexConsumer output,int light){
    Bone bone=mesh.bones[index];float[] translation={0,0,0},rotation={0,0,0},scale={1,1,1};
    Track track=tracks[index];
    if(play&&track!=null){
      float time=mesh.clip.loop?seconds%mesh.clip.duration:Math.min(seconds,mesh.clip.duration);
      Frame a=track.keyframes[0],b=a;
      for(Frame frame:track.keyframes){if(frame.time<=time)a=frame;if(frame.time>=time){b=frame;break;}b=frame;}
      float fraction=a.time==b.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
      for(int i=0;i<3;i++){translation[i]=mix(a.translation[i],b.translation[i],fraction);rotation[i]=mix(a.rotation[i],b.rotation[i],fraction);scale[i]=mix(a.scale[i],b.scale[i],fraction);}
    }
    matrices.${push}();matrices.translate(bone.position[0]+translation[0],bone.position[1]+translation[1],bone.position[2]+translation[2]);
    float x=(bone.rotation[0]+rotation[0])*RAD,y=(bone.rotation[1]+rotation[1])*RAD,z=(bone.rotation[2]+rotation[2])*RAD;
    matrices.${rotate}("ZYX".equals(mesh.order)?new Quaternionf().rotationZYX(z,y,x):new Quaternionf().rotationXYZ(x,y,z));
    matrices.scale(scale[0],scale[1],scale[2]);
    Vector3f n=new Vector3f();
    for(float[] v:bone.vertices){
      n.set(v[5],v[6],v[7]).mul(${normal}).normalize();
      output.${vertex}(${position},v[0],v[1],v[2]).${color}(255,255,255,255).${uv}(v[3],v[4]).${overlay}(${official ? 'net.minecraft.client.renderer.texture.OverlayTexture.NO_OVERLAY' : 'net.minecraft.client.render.OverlayTexture.DEFAULT_UV'}).${light}(light).${normalMethod}(n.x(),n.y(),n.z())${end};
    }
    for(int child:bone.children)bone(child,seconds,play,matrices,output,light);
    matrices.${pop}();
  }
  private static float mix(float a,float b,float f){return a+(b-a)*f;}
  private static final class Mesh {int version;String order;float radius;Bone[] bones;Clip clip;}
  private static final class Bone {int parent;int[] children;float[] position,rotation;float[][] vertices;}
  private static final class Clip {String name;float duration;boolean loop;Track[] tracks;}
  private static final class Track {int bone;Frame[] keyframes;}
  private static final class Frame {float time;float[] translation,rotation,scale;}
}
`;
  return {
    path: 'src/main/java/' + pkg.replaceAll('.', '/') + '/StudioEntityRenderer.java',
    content: text
      .replaceAll('TextureId', official ? 'ResourceLocation' : 'Identifier')
      .replaceAll('MatrixType', official ? 'PoseStack' : 'MatrixStack')
      .replaceAll('BuffersType', official ? 'MultiBufferSource' : 'VertexConsumerProvider'),
  };
}
