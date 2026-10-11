/**
 * Derivative of @tscircuit/repair04 at
 * 81d4585d335ea1958a1c6569e4064c58cba44bad (MIT, see ../LICENSE).
 * Scalar IEEE f64 operations retain the native Gauss-Seidel constraint order.
 * Physical via guards execute in JavaScript at their original proposed positions.
 */
typedef unsigned int u32;
extern void guard_vertex(u32 index, double x, double y, int tangents);
#define VSTRIDE 12
#define PSTRIDE 24
#define DSTRIDE 32
static inline double mn(double a,double b){return __builtin_wasm_min_f64(a,b);}
static inline double mx(double a,double b){return __builtin_wasm_max_f64(a,b);}
static inline double ab(double a){return __builtin_fabs(a);}
static inline double len(double x,double y){double scale=mx(ab(x),ab(y));if(scale==0 || scale==__builtin_inf())return scale;double sx=x/scale,sy=y/scale;return scale*__builtin_sqrt(sx*sx+sy*sy);}
static void contact(double ax,double ay,double bx,double by,double cx,double cy,double dx,double dy,double*o){
 double ux=bx-ax,uy=by-ay,vx=dx-cx,vy=dy-cy,wx=ax-cx,wy=ay-cy;
 double aa=ux*ux+uy*uy,bb=ux*vx+uy*vy,cc=vx*vx+vy*vy,dd=ux*wx+uy*wy,ee=vx*wx+vy*wy,det=aa*cc-bb*bb;
 double s=det>1e-15?mx(0,mn(1,(bb*ee-cc*dd)/det)):0;
 if(cc<1e-15)s=aa>1e-15?mx(0,mn(1,-dd/aa)):0;
 double t=cc>1e-15?(bb*s+ee)/cc:0;
 if(t<0){t=0;s=aa>1e-15?mx(0,mn(1,-dd/aa)):0;}
 else if(t>1){t=1;s=aa>1e-15?mx(0,mn(1,(bb-dd)/aa)):0;}
 double x=ax+s*ux-cx-t*vx,y=ay+s*uy-cy-t*vy;
 o[0]=s;o[1]=t;o[2]=x;o[3]=y;o[4]=len(x,y);
}
static void project(double*v,int*ids,double*weights,int n,double nx,double ny,double deficit,int tangents){
 int ci[4],count=0;double cw[4];
 for(int i=0;i<n;i++){
  int id=ids[i];double*vp=v+id*VSTRIDE;if(vp[4])continue;
  int index=-1;for(int j=0;j<count;j++)if(ci[j]==id){index=j;break;}
  if(index<0){ci[count]=id;cw[count]=0.0+weights[i];count++;}else cw[index]=cw[index]+weights[i];
 }
 double mass=0;for(int i=0;i<count;i++)mass=mass+cw[i]*cw[i];if(mass<1e-15)return;
 double scale=mn(.05,deficit*.7)/mass;
 for(int i=0;i<count;i++){
  double*vp=v+ci[i]*VSTRIDE,weight=cw[i];
  double x=mx(mx(vp[6],vp[2]-.25),mn(mn(vp[7],vp[2]+.25),vp[0]+nx*scale*weight));
  double y=mx(mx(vp[8],vp[3]-.25),mn(mn(vp[9],vp[3]+.25),vp[1]+ny*scale*weight));
  if(vp[10]){guard_vertex(ci[i],x,y,tangents);continue;}
  if(vp[0]!=x || vp[1]!=y)vp[5]++;
  vp[0]=x;vp[1]=y;
 }
}
static void bounds(double*v,int ai,int bi,double*s){
 double*a=v+ai*VSTRIDE,*b=v+bi*VSTRIDE;
 union{double d;unsigned long long u;} aa,bb;
 int stable=s[8]!=0;
 for(int i=0;i<4;i++){aa.d=s[i];bb.d=i<2?a[i]:b[i-2];if(aa.u!=bb.u)stable=0;}
 if(stable)return;
 s[0]=a[0];s[1]=a[1];s[2]=b[0];s[3]=b[1];
 s[4]=mn(a[0],b[0]);s[5]=mx(a[0],b[0]);s[6]=mn(a[1],b[1]);s[7]=mx(a[1],b[1]);s[8]=1;
}
static void pair(double*v,double*s,double*p,int reject){
 int ids[4]={(int)p[0],(int)p[1],(int)p[2],(int)p[3]};
 double*a=v+ids[0]*VSTRIDE,*b=v+ids[1]*VSTRIDE,*c=v+ids[2]*VSTRIDE,*d=v+ids[3]*VSTRIDE;
 if(a[5]!=p[4] || b[5]!=p[5] || c[5]!=p[6] || d[5]!=p[7]){
  p[11]=0;
  if(reject){
   double*as=s+(int)p[17]*12,*bs=s+(int)p[18]*12;
   bounds(v,ids[0],ids[1],as);bounds(v,ids[2],ids[3],bs);
   double gx=mx(mx(0,as[4]-bs[5]),bs[4]-as[5]),gy=mx(mx(0,as[6]-bs[7]),bs[6]-as[7]);
   p[11]=gx*gx+gy*gy>p[9];
  }
  if(!p[11]){contact(a[0],a[1],b[0],b[1],c[0],c[1],d[0],d[1],p+12);p[19]=1;}
  p[4]=a[5];p[5]=b[5];p[6]=c[5];p[7]=d[5];
 }
 if(p[11])return;
 double*co=p+12,required=p[8];if(co[4]>=required || co[4]<1e-10)return;
 double weights[4]={1-co[0],co[0],co[1]-1,-co[1]};for(int i=0;i<4;i++)p[20+i]=weights[i];
 project(v,ids,weights,4,co[2]/co[4],co[3]/co[4],required-co[4],(int)p[10]);
}
static void interior(double x,double y,double*corners,double*o){
 o[0]=1;o[1]=0;o[2]=0;o[3]=__builtin_inf();
 for(int i=0;i<4;i++){
  int j=(i+1)%4;double ax=corners[i*2],ay=corners[i*2+1],bx=corners[j*2],by=corners[j*2+1];
  double dx=bx-ax,dy=by-ay,l=len(dx,dy),nx=dy/l,ny=-dx/l,depth=-((x-ax)*nx+(y-ay)*ny);
  if(depth<0){o[0]=0;return;}if(depth<o[3]){o[1]=nx;o[2]=ny;o[3]=depth;}
 }
}
static void pad(double*v,double*p){
 int ids[2]={(int)p[0],(int)p[1]},endpoints=ids[0]==ids[1]?1:2;double*corners=p+7,required=p[2];
 for(int e=0;e<endpoints;e++){
  double*vp=v+ids[e]*VSTRIDE,*ip=p+20+e*4;
  if(vp[5]!=p[5+e]){interior(vp[0],vp[1],corners,ip);p[5+e]=vp[5];}
  if(ip[0]){int id=ids[e];double weight=1;project(v,&id,&weight,1,ip[1],ip[2],required+ip[3],0);}
 }
 double*a=v+ids[0]*VSTRIDE,*b=v+ids[1]*VSTRIDE,*co=p+15;
 if(a[5]!=p[3] || b[5]!=p[4]){
  contact(a[0],a[1],b[0],b[1],corners[0],corners[1],corners[2],corners[3],co);
  for(int i=1;i<4;i++){
   int j=(i+1)%4;double temp[5];contact(a[0],a[1],b[0],b[1],corners[i*2],corners[i*2+1],corners[j*2],corners[j*2+1],temp);
   if(!(co[4]<temp[4]))for(int k=0;k<5;k++)co[k]=temp[k];
  }
  p[3]=a[5];p[4]=b[5];p[30]=1;
 }
 if(co[4]<1e-10 || co[4]>=required)return;
 double weights[2]={1-co[0],co[0]};p[28]=weights[0];p[29]=weights[1];project(v,ids,weights,2,co[2]/co[4],co[3]/co[4],required-co[4],0);
}
__attribute__((export_name("batch"))) void batch(double*v,double*s,double*p,double*d,int pi,int pend,int di,int dend,int reject,volatile double*cursor){cursor[0]=pi;cursor[1]=di;for(;pi<pend;pi++){cursor[0]=pi+1;pair(v,s,p+pi*PSTRIDE,reject);}for(;di<dend;di++){cursor[1]=di+1;pad(v,d+di*DSTRIDE);}}
