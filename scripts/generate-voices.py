# Run on macOS with the built-in Milena/Samantha voices and ffmpeg.
import subprocess
import sys
from pathlib import Path
phrases={'lastStand':'Вся надежда на тебя!', 'steel':'Стальная серия!', 'unstoppable':'Не остановить!', 'master':'Хозяин арены!', 'legend':'Легенда сектора шестьдесят семь!', 'six':'Шесть за семь!', 'boss':'Босс! В лом!', 'point':'Точка наша!', 'power':'Six! Seven!'}
for key, phrase in phrases.items():
    if len(sys.argv)>1 and key not in sys.argv[1:]: continue
    raw=Path('/tmp')/f'roma-{key}.aiff'
    subprocess.run(['say','-v','Samantha' if key=='power' else 'Milena','-r','185','-o',str(raw),phrase],check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(raw),'-af','atrim=start=0.03,highpass=f=100,acompressor=threshold=0.1:ratio=3,aecho=0.8:0.7:65:0.18,alimiter=limit=0.8','-ar','24000','-ac','1',f'public/audio/{key}.wav'],check=True)
    print(key,flush=True)
