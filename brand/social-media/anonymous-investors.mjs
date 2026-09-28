// X post: "Anonymous investors. Auditable activity."
// The chameleon is recolored onto the brand neon ramp so it matches the kit.
// Usage: node brand/social-media/anonymous-investors.mjs  (writes .svg, then renders .png with Chrome)

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const W = 1600
const H = 900

const INK = '#050706'
const NEON = '#31c47e'
const ECHO = '#49c9a0'
const TEXT = '#f2f7f4'
const MUTED = 'rgba(242,247,244,0.56)'

// mascot green -> brand ramp, dark to light
const RAMP = {
  '#1B1D1B': '#2c3431',
  '#1F261E': '#2a3631',
  '#20351F': '#1f3d2e',
  '#285A23': '#194a31',
  '#306D29': '#1d5639',
  '#397D2E': '#216244',
  '#429633': '#27744e',
  '#4EAA3A': '#2d8358',
  '#5FBE43': '#349365',
  '#7DD852': '#3da474',
  '#94E85F': '#48b886',
}

const mascot = readFileSync(join(HERE, 'maskot.svg'), 'utf8')
  .replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
  .replace(/fill="(#[0-9A-Fa-f]{6})"/g, (m, c) => `fill="${RAMP[c.toUpperCase()] ?? c}"`)

const logo = readFileSync(join(HERE, '../diagrams/site/gizulogo.svg'), 'utf8')
  .replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
  .replace(/#FEFEFE/g, NEON)

const font = (w) => `fonts/HelveticaNeue-${w}.ttf`

// glitch echo headline, same treatment as the X cover
const headline = (x, y, s, fill) => `
  <text x="${x + 5}" y="${y + 4}" class="h" fill="${ECHO}" fill-opacity="0.35">${s}</text>
  <text x="${x}" y="${y}" class="h" fill="${fill}">${s}</text>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      @font-face { font-family: 'HN'; font-weight: 500; src: url('${font(500)}'); }
      @font-face { font-family: 'HN'; font-weight: 700; src: url('${font(700)}'); }
      text { font-family: 'HN', 'Helvetica Neue', Arial, sans-serif; }
      .h { font-size: 72px; font-weight: 700; letter-spacing: -1.8px; }
      .s { font-size: 30px; font-weight: 500; letter-spacing: -0.3px; }
    </style>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${NEON}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${NEON}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wave" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#12241b" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#0a130f" stop-opacity="0.2"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${INK}"/>
  <path d="M0 640 C 420 520 900 560 ${W} 380 L ${W} ${H} L 0 ${H} Z" fill="url(#wave)"/>
  <circle cx="380" cy="820" r="460" fill="url(#glow)"/>

  <g transform="translate(110 96) scale(0.078)">${logo}</g>
  <text x="186" y="146" font-size="44" font-weight="500" letter-spacing="-1.1" fill="${TEXT}">Gizu</text>

  ${headline(790, 400, 'Anonymous investors.', TEXT)}
  ${headline(790, 488, 'Auditable activity.', NEON)}
  <text x="792" y="565" class="s" fill="${MUTED}">One deposit. Several positions. No public trail.</text>

  <g transform="translate(50 440) scale(2.8)">${mascot}</g>
</svg>`

const svgPath = join(HERE, 'anonymous-investors.svg')
writeFileSync(svgPath, svg)
console.log('anonymous-investors.svg written')

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome']
  .find(existsSync)
if (CHROME) {
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`,
    `--screenshot=${join(HERE, 'anonymous-investors.png')}`, pathToFileURL(svgPath).href], { stdio: 'ignore' })
  console.log('anonymous-investors.png written')
}
