from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
import json
root=Path('.');out=root/'public/assets/v6';out.mkdir(exist_ok=True)
people=Image.open('output/imagegen/people.png'); manifest=json.loads(Path('public/assets/v2/manifest.json').read_text(encoding='utf8'))
# Inspected actual row boundaries: 406 and 834, rather than equal thirds.
ys=[(0,406),(408,834),(836,1287)];xs=[(0,405),(412,811),(822,1222)]
contact=Image.new('RGB',(900,960),'#faf6e9')
for row,(y0,y1) in enumerate(ys):
 for col,(x0,x1) in enumerate(xs):
  box=[x0,y0,x1,y1];im=people.crop(box);name=f'person-{row}-{col}'
  im.save(f'public/assets/v2/{name}.webp',quality=92)
  for entry in manifest:
   if entry['id']==name: entry.update(region=box,width=im.width,height=im.height)
  thumb=ImageOps.contain(im,(290,300));contact.paste(thumb,(col*300,row*320))
contact.save('work/portraits-v051.jpg')
Path('public/assets/v2/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
comic=Image.open('output/imagegen/comic.png');records=[]
for i,box in enumerate([[0,0,764,507],[774,0,1536,507],[0,518,764,1024],[774,518,1536,1024]]):
 im=comic.crop(box);im.save(out/f'opening-{i+1}.webp',quality=94)
 records.append(dict(id=f'opening-{i+1}',path=f'assets/v6/opening-{i+1}.webp',source='output/imagegen/comic.png',region=box,width=im.width,height=im.height,anchor=[.5,.5],model='gpt-image-2.5-sunburst',operation='crop inspected existing original; no generation request'))
(out/'manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf8')
