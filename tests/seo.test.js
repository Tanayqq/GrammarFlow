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
