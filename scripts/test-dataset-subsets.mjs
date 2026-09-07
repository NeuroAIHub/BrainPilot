import { startDatasetDownload, listDatasetJobs, stopDatasetDownloads } from '../packages/backend-core/dist/datasets.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = await mkdtemp(path.join(tmpdir(), 'bp-round2-live-'));
try {
  const launched = await Promise.all([
    startDatasetDownload(root,'physionet-eegmat',{},'sample'),
    startDatasetDownload(root,'physionet-gaitpdb',{},'sample'),
    startDatasetDownload(root,'mne-fnirs-motor'),
    startDatasetDownload(root,'10x-pbmc3k'),
  ]);
  const deadline = Date.now()+180000;
  while(Date.now()<deadline) {
    const jobs=await listDatasetJobs(root);
    if(jobs.every(job=>['completed','failed','cancelled'].includes(job.status))) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  for(const job of await listDatasetJobs(root)) {
    console.log(JSON.stringify({dataset:job.datasetId,scope:job.selectionId,status:job.status,bytes:job.bytesDownloaded,error:job.error}));
    if(job.status!=='completed')throw new Error(`Download failed: ${job.datasetId}`);
  }
  const eeg=launched.find(job=>job.datasetId==='physionet-eegmat');
  const header=(await readFile(path.join(eeg.targetDir,'Subject00_2.edf'))).subarray(0,8).toString();
  if(header.trim()!=='0')throw new Error('EEG sample does not have an EDF header');
  for(const [id,file] of [['mne-fnirs-motor','MNE-fNIRS-motor-data.tgz'],['10x-pbmc3k','pbmc3k_filtered_gene_bc_matrices.tar.gz']]){
    const j=launched.find(job=>job.datasetId===id);
    const listing=execFileSync('tar',['-tzf',path.join(j.targetDir,file)],{encoding:'utf8'});
    if(!listing.trim())throw new Error('Empty archive');
    console.log(`${id}: archive readable, ${listing.trim().split('\n').length} entries`);
  }
  const history=JSON.parse(await readFile(path.join(root,'data/datasets/.jobs.json'),'utf8'));
  if(history.length!==4 || history.some(job=>job.status!=='completed'))throw new Error('Persisted history mismatch');
  console.log('EDF header, archives and persisted history verified.');
} finally { await stopDatasetDownloads(root); await rm(root,{recursive:true,force:true}); }
