import subprocess, colorsys, random, concurrent.futures as cf
random.seed(7)
words=["NORTH","ECHO","LUMEN","DRIFT","ORBIT","HARBOR","CINDER","VELVET","ATLAS","MERIDIAN","SOLACE","EMBER","TIDE","QUARTZ","HALO","NOMAD","AURORA","SUMMIT","RIVET","PRISM"]
def hexc(h,s,v):
    r,g,b=colorsys.hsv_to_rgb(h,s,v); return '#%02x%02x%02x'%(int(r*255),int(g*255),int(b*255))
jobs=[]
for i in range(240):
    h=random.random(); a=hexc(h,0.55,0.85); b=hexc((h+0.12)%1,0.75,0.25)
    w=words[i%len(words)]+(" "+str(i//20+1) if i>=20 else "")
    jobs.append(["convert","-size","342x513",f"gradient:{a}-{b}","-gravity","south","-pointsize","40","-fill","white","-annotate","+0+60",w,"-quality","82",f"p{i}.jpg"])
for i in range(40):
    h=random.random(); a=hexc(h,0.5,0.7); b=hexc((h+0.3)%1,0.6,0.15)
    jobs.append(["convert","-size","780x439",f"radial-gradient:{a}-{b}","-quality","80",f"b{i}.jpg"])
for i in range(24):
    h=random.random(); a=hexc(h,0.4,0.8); b=hexc((h+0.2)%1,0.6,0.3)
    jobs.append(["convert","-size","300x169",f"gradient:{a}-{b}","-quality","80",f"s{i}.jpg"])
for i in range(30):
    h=random.random(); a=hexc(h,0.25,0.75); b=hexc(h,0.35,0.35)
    jobs.append(["convert","-size","185x278",f"gradient:{a}-{b}","-quality","80",f"a{i}.jpg"])
with cf.ThreadPoolExecutor(8) as ex: list(ex.map(subprocess.run, jobs))
