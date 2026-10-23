/** XHR exposes real upload byte counts as well as incremental response text.
 * Never invent an encoding percentage from elapsed time: only ffmpeg knows it.
 * Inactivity, rather than a short total deadline, allows large/slow transfers. */
export function uploadWithProgress(url, formData, { headers = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let offset = 0;
    let pending = '';
    let result;
    let receivedResult = false;
    let streamError;
    let timer;
    const fail = (message, status = 0) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(message), { status }));
    };
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fail('The upload stopped responding. Reload the media list before retrying.');
        xhr.abort();
      }, 120_000);
    };
    const read = () => {
      touch();
      if (!xhr.getResponseHeader('Content-Type')?.includes('application/x-ndjson')) return;
      pending += xhr.responseText.slice(offset);
      offset = xhr.responseText.length;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'progress') onProgress(event);
          if (event.type === 'result') { result = event.result; receivedResult = true; }
          if (event.type === 'error') streamError = event.error;
        } catch { streamError = 'The server returned unreadable upload progress.'; }
      }
    };
    xhr.open('POST', url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.setRequestHeader('Accept', 'application/x-ndjson');
    xhr.upload.onprogress = (event) => {
      touch();
      onProgress({ stage: 'uploading', percent: event.lengthComputable ? Math.min(100, event.loaded / event.total * 100) : null });
    };
    xhr.upload.onload = () => { touch(); onProgress({ stage: 'preparing', percent: null }); };
    xhr.onprogress = read;
    xhr.onerror = () => fail('Connection lost. Reload the media list before retrying.');
    xhr.onabort = () => fail('Upload interrupted. Reload the media list before retrying.');
    xhr.onload = () => {
      read();
      clearTimeout(timer);
      if (xhr.status < 200 || xhr.status >= 300) {
        let body;
        try { body = JSON.parse(xhr.responseText); } catch { /* Proxy errors can be HTML. */ }
        return fail(body?.error || (xhr.status === 413 ? 'These files exceed the server upload limit. Choose smaller files or ask the administrator to raise the limit.' : `Upload failed (HTTP ${xhr.status})`), xhr.status);
      }
      if (streamError) return fail(streamError);
      if (receivedResult) return resolve(result);
      if (xhr.getResponseHeader('Content-Type')?.includes('application/x-ndjson')) {
        return fail('The upload ended without confirmation. Reload the media list before retrying.');
      }
      // Compatible with servers that have not yet enabled progress streaming.
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { fail('The upload ended without confirmation. Reload the media list before retrying.'); }
    };
    touch();
    xhr.send(formData);
  });
}
