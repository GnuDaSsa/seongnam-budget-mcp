"""Download publicly licensed fixed model revision; no API credentials needed."""
import json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REV='73908c3438cf03b6a01bcb9611d62b23d0726f08'
folder=ROOT/'work/models/potion';folder.mkdir(parents=True,exist_ok=True)
for name in ['model.safetensors','tokenizer.json','config.json','README.md']:
    target=folder/name
    if target.exists():continue
    url=f'https://huggingface.co/minishlab/potion-multilingual-128M/resolve/{REV}/{name}'
    temp=target.with_suffix(target.suffix+'.part')
    subprocess.run(['curl','-L','--fail','--retry','2','--max-time','600',url,'-o',str(temp)],check=True)
    temp.replace(target)
print(json.dumps({'model':'minishlab/potion-multilingual-128M','revision':REV,'path':str(folder)}))
