const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const SITE = 'https://grammarflowt.vercel.app';

test('the homepage has a title, description, canonical address and share tags that search engines can use', () => {
    const html = read('public/index.html');
    const title = html.match(/<title>([^<]+)<\/title>/)[1].replace('&amp;', '&');
    const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(title.length >= 20 && title.length <= 60, title);
    assert.ok(description.length >= 70 && description.length <= 160, String(description.length));
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/">`));
    for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) assert.match(html, new RegExp(`property="${tag}"`), tag);
});

test('the structured data is valid JSON and claims no ratings or reviews', () => {
    const block = read('public/index.html').match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
    const data = JSON.parse(block);
    assert.equal(data['@type'], 'WebApplication');
    assert.equal(data.url, SITE + '/');
    assert.doesNotMatch(block, /aggregateRating|"review"/i);
});

test('robots.txt, the sitemap, llms.txt, the icon and the share image are real files', () => {
    for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt', 'favicon.svg', 'og-image.png']) assert.ok(existsSync(path.join(root, 'public', file)), file);
    assert.match(read('public/robots.txt'), new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
    assert.match(read('public/sitemap.xml'), new RegExp(`<loc>${SITE}/</loc>`));
    assert.equal(readFileSync(path.join(root, 'public', 'og-image.png')).subarray(1, 4).toString(), 'PNG');
});

test('the Google Search Console ownership tag stays on the homepage', () => {
    // parsed, so a commented-out tag does not count; the token is the one Google issued for this property
    const { JSDOM } = require('jsdom');
    const tags = new JSDOM(read('public/index.html').replace(/^[^<]+/, '')).window.document.head.querySelectorAll('meta[name="google-site-verification"]');
    assert.equal(tags.length, 1);
    assert.equal(tags[0].content, 'NT46P7ComlYZiG-m7PrHxYTPOxhhiFACfUmhnF2Ll5A');
});

test('the homepage explains its features in visible text, and makes no detector promise', () => {
    const { JSDOM } = require('jsdom');
    const doc = new JSDOM(read('public/index.html').replace(/^[^<]+/, '')).window.document;
    const guide = doc.querySelector('.feature-guide');
    assert.ok(guide && !guide.closest('.hidden'), 'it is not tucked away in a hidden panel');
    assert.ok(guide.querySelectorAll('h3').length >= 6);
    for (const word of [/PDF/, /humanizer/i, /teleprompter/i, /Hinglish/]) assert.match(guide.textContent, word);
    assert.match(guide.textContent, /does not promise to pass AI detectors/);
    assert.match(guide.textContent, /sent to our AI provider/);
});

test('there is a not-found page that search engines are told not to list', () => {
    const page = read('public/404.html');
    assert.match(page, /<meta name="robots" content="noindex">/);
    assert.match(page, /Page not found/);
    assert.doesNotMatch(page, /<script/);
});

test('Vercel does not see package.json, so unknown addresses get the 404 page, and its build does not need it', () => {
    const ignored = read('.vercelignore').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
    assert.deepEqual(ignored, ['package.json', 'package-lock.json']);
    const vercel = JSON.parse(read('vercel.json'));
    assert.equal(vercel.installCommand, '');
    assert.match(vercel.buildCommand, /^node dev-editor-demo\/build-public\.mjs$/);
    const build = read('dev-editor-demo/build-public.mjs');
    for (const [, from] of build.matchAll(/from\s+'([^']+)'/g)) assert.match(from, /^(node:|\.)/, `the build imports the package ${from}`);
});
