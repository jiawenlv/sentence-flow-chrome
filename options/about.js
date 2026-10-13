document.getElementById('version').textContent = `Version ${chrome.runtime.getManifest().version} · MIT License`;
async function readDocument(name) {
  const response = await fetch(chrome.runtime.getURL(name));
  if (!response.ok) throw new Error(`无法加载 ${name}`);
  return response.text();
}
void readDocument('LICENSE').then(text=>{document.getElementById('license-text').textContent=text;},()=>{document.getElementById('license-text').textContent='许可加载失败，请在扩展项目根目录查看 LICENSE，或重新加载扩展后重试。';});
void readDocument('PRIVACY.md').then(text=>{
  const list=document.getElementById('privacy-list'); list.replaceChildren();
  for(const line of text.split('\n').filter(line=>line.startsWith('- '))){const item=document.createElement('li');item.textContent=line.slice(2);list.append(item);}
},()=>{document.getElementById('privacy-list').textContent='隐私说明加载失败，请在扩展项目根目录查看 PRIVACY.md，或重新加载扩展后重试。';});
