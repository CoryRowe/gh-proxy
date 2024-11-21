'use strict'

/**
 * static files (404.html, sw.js, conf.js)
 */
const ASSET_URL = 'https://github.com/CoryRowe/gh-proxy'
// 前缀，如果自定义路由为example.com/gh/*，将PREFIX改为 '/gh/'，注意，少一个杠都会错！
const PREFIX = '/'
// 分支文件使用jsDelivr镜像的开关，0为关闭，默认关闭
const Config = {
    jsdelivr: 0
}

const whiteList = [] // 白名单，路径里面有包含字符的才会通过，e.g. ['/username/']

/** @type {RequestInit} */
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}


const URL_REGEX = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive|blob|raw|info|git-|tags).*$/i;
const RAW_URL_REGEX = /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
const GIST_URL_REGEX = /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;


/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*';
    return new Response(body, { status, headers });
}


/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
    try {
        return new URL(urlStr);
    } catch (err) {
        return null;
    }
}


addEventListener('fetch', e => {
    const ret = fetchHandler(e)
    .catch(err => makeRes('cfworker error:\n' + err.stack, 502));
    e.respondWith(ret);
});


function checkUrl(u) {
    for (let i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
        if (u.search(i) === 0) {
            return true
        }
    }
    return false
}

/**
 * @param {FetchEvent} e
 */
async function fetchHandler(e) {
    const req = e.request;
    const urlStr = req.url;
    const urlObj = new URL(urlStr);
    let path = urlObj.searchParams.get('q');
    if (path) {
        return Response.redirect('https://' + urlObj.host + PREFIX + path, 301);
    }
    // cfworker 会把路径中的 `//` 合并成 `/`
    path = urlObj.href.substr(urlObj.origin.length + PREFIX.length).replace(/^https?:\/+/, 'https://');
    if (checkUrl(path)) {
        return httpHandler(req, path);
    } else if (RAW_URL_REGEX.test(path) || GIST_URL_REGEX.test(path)) {
        return handleRawOrGistUrl(req, path);
    } else {
        return fetch(ASSET_URL + path);
    }
}

function handleRawOrGistUrl(req, path) {
    if (Config.jsdelivr) {
        const newUrl = path.replace('/blob/', '@').replace(/^(?:https?:\/\/)?github\.com/, 'https://cdn.jsdelivr.net/gh');
        return Response.redirect(newUrl, 302);
    } else {
        path = path.replace('/blob/', '/raw/');
        return httpHandler(req, path);
    }
}


/**
 * @param {Request} req
 * @param {string} pathname
 */
function httpHandler(req, pathname) {
    const reqHdrRaw = req.headers;

    // preflight
    if (req.method === 'OPTIONS' &&
        reqHdrRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT);
    }

    const reqHdrNew = new Headers(reqHdrRaw);

    let urlStr = pathname;
    let flag = !Boolean(whiteList.length);
    for (let i of whiteList) {
        if (urlStr.includes(i)) {
            flag = true;
            break;
        }
    }
    if (!flag) {
        return new Response("blocked", {status: 403});
    }
    if (urlStr.startsWith('github')) {
        urlStr = 'https://' + urlStr;
    }
    const urlObj = newUrl(urlStr);

    /** @type {RequestInit} */
    const reqInit = {
        method: req.method,
        headers: reqHdrNew,
        redirect: 'manual',
        body: req.body
    };
    return proxy(urlObj, reqInit);
}


/**
 *
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit);
    const resHdrOld = res.headers;
    const resHdrNew = new Headers(resHdrOld);

    if (resHdrNew.has('location')) {
        let _location = resHdrNew.get('location');
        if (checkUrl(_location)) {
            resHdrNew.set('location', PREFIX + _location);
        } else {
            reqInit.redirect = 'follow';
            return proxy(newUrl(_location), reqInit);
        }
    }
    resHdrNew.set('access-control-expose-headers', '*');
    resHdrNew.set('access-control-allow-origin', '*');

    ['content-security-policy', 'content-security-policy-report-only', 'clear-site-data'].forEach(header => resHdrNew.delete(header));

    return new Response(res.body, {
        status: res.status,
        headers: resHdrNew,
    });
}

