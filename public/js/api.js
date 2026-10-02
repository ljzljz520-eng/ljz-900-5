// 接口封装：token 存 localStorage，请求头带 Bearer
const TOKEN_KEY = 'hq_token';
const USER_KEY = 'hq_user';

const api = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  },
  setUser(u) { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },

  async request(method, url, body, isForm) {
    const headers = {};
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let payload = body;
    if (body && !isForm) headers['Content-Type'] = 'application/json';
    const resp = await fetch(url, { method, headers, body });
    let data = null;
    try { data = await resp.json(); } catch (e) { /* 非 json */ }
    if (!resp.ok) {
      const err = new Error((data && data.error) || '请求失败 (' + resp.status + ')');
      err.status = resp.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body ? JSON.stringify(body) : null); },
  patch(url, body) { return this.request('PATCH', url, JSON.stringify(body)); },
  del(url) { return this.request('DELETE', url); },
  upload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      if (this.token) xhr.setRequestHeader('Authorization', 'Bearer ' + this.token);
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error) || '上传失败 (' + xhr.status + ')'));
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      }
      xhr.send(formData);
    });
  }
};
