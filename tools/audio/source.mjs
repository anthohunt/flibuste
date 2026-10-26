#!/usr/bin/env node
// Boîte à outils de sourcing audio libre de droit.
//   search <mots> [--type=music|sound]   -> pages candidates sur OpenGameArt
//   page <slug|url>                      -> licence, auteur, fichiers audio directs
//   dl <url> <sortie>                    -> télécharge et valide avec ffprobe
//   probe <fichier>                      -> durée, canaux, débit, crête
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, stat } from 'node:fs/promises'
const sh = promisify(execFile)
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

async function get(url) {
  const { stdout } = await sh('curl', ['-sL', '-m', '45', '-A', UA, url], { maxBuffer: 64 << 20 })
  return stdout
}

const TYPE = { music: 12, sound: 13 }

async function search(keys, type) {
  const tid = TYPE[type] ?? ''
  const url = `https://opengameart.org/art-search-advanced?keys=${encodeURIComponent(keys)}` +
    (tid ? `&field_art_type_tid%5B%5D=${tid}` : '') + '&sort_by=count&sort_order=DESC'
  const html = await get(url)
  const slugs = [...new Set([...html.matchAll(/href="\/content\/([^"?#]+)"/g)].map((m) => m[1]))]
    .filter((s) => s !== 'faq')
  // le titre suit le lien dans le markup de la liste
  const titres = new Map()
  for (const m of html.matchAll(/href="\/content\/([^"?#]+)"[^>]*>([^<]{2,120})</g)) {
    if (!titres.has(m[1])) titres.set(m[1], m[2].trim())
  }
  return slugs.map((s) => ({ slug: s, titre: titres.get(s) || s, url: `https://opengameart.org/content/${s}` }))
}

const LICENCES = [
  [/CC0/i, 'CC0'],
  [/CC-BY-SA\s*([0-9.]+)/i, 'CC-BY-SA'],
  [/CC-BY\s*([0-9.]+)/i, 'CC-BY'],
  [/OGA-BY\s*([0-9.]+)/i, 'OGA-BY'],
  [/GPL\s*([0-9.]+)/i, 'GPL'],
]

async function page(ref) {
  const url = ref.startsWith('http') ? ref : `https://opengameart.org/content/${ref}`
  const html = await get(url)
  const fichiers = [...new Set([...html.matchAll(/href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"]+)"/g)]
    .map((m) => m[1]))].filter((u) => /\.(mp3|ogg|wav|flac|opus|zip|xm|it|mod)$/i.test(u))
  const bloc = (html.match(/License\(s\):[\s\S]{0,2000}/i) || [''])[0]
  const licences = LICENCES.filter(([re]) => re.test(bloc)).map(([, n]) => n)
  const titre = ((html.match(/<title>([^<]+)<\/title>/i) || [, ''])[1] || '').replace(/\s*\|.*$/, '').trim()
  const auteur = [...new Set([...html.matchAll(/\/users\/([a-z0-9_-]+)/gi)].map((m) => m[1]))].slice(0, 3)
  const attribution = (bloc.match(/Attribution Instructions:[\s\S]{0,600}/i) || [''])[0]
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)
  return { url, titre, licences, auteur, attribution, fichiers }
}

async function probe(f) {
  const { stdout } = await sh('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,bit_rate,format_name:stream=channels,sample_rate,codec_name', '-of', 'json', f])
  const j = JSON.parse(stdout)
  const s = (await stat(f)).size
  return { octets: s, ...j.format, ...(j.streams?.[0] || {}) }
}

async function dl(url, out) {
  const { stdout } = await sh('curl', ['-sL', '-m', '300', '-A', UA, '-w', '%{http_code}', '-o', out, url],
    { maxBuffer: 8 << 20 })
  const code = stdout.trim().slice(-3)
  if (code !== '200') throw new Error(`HTTP ${code} pour ${url}`)
  const info = await probe(out).catch((e) => ({ erreur: String(e).slice(0, 200) }))
  if (info.erreur) throw new Error(`fichier non lisible par ffprobe : ${info.erreur}`)
  return { out, code, ...info }
}

const [cmd, ...rest] = process.argv.slice(2)
const type = (rest.find((a) => a.startsWith('--type=')) || '').split('=')[1]
const args = rest.filter((a) => !a.startsWith('--'))
try {
  const r = cmd === 'search' ? await search(args.join(' '), type)
    : cmd === 'page' ? await page(args[0])
    : cmd === 'dl' ? await dl(args[0], args[1])
    : cmd === 'probe' ? await probe(args[0])
    : (() => { throw new Error('usage: search|page|dl|probe') })()
  console.log(JSON.stringify(r, null, 2))
} catch (e) {
  console.error(JSON.stringify({ erreur: String(e.message || e) }))
  process.exit(1)
}
