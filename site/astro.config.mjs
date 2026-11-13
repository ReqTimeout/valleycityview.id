import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import rehypeRaw from 'rehype-raw';
import { rehypeResponsiveImages } from './plugins/rehype-responsive-images.mjs';

export default defineConfig({
  // Canonical origin = domain live saat ini (valleycityview.id, zone Cloudflare
  // akun ini). valleycity.id masih situs lama sampai cutover; kalau nanti
  // pindah, ubah satu baris ini + `origin` di src/data/site.ts lalu rebuild.
  site: 'https://valleycityview.id',
  output: 'static',
  // The build uses `format: 'directory'` and every internal link ends with a
  // slash, so the canonical URL of a page is `/blog/<slug>/` — that keeps the
  // local preview, the sitemap and the 301 map pointing at the same address.
  trailingSlash: 'always',
  build: {
    format: 'directory',
    inlineStylesheets: 'always',
  },
  compressHTML: true,
  markdown: {
    /*
      The imported WordPress articles are markdown files whose bodies are raw
      HTML (`<figure>`, `<h2>`, `<br />`). Without rehype-raw those strings are
      pasted into the page untouched, so every image inside an article kept its
      original full-size file with no srcset and no "Ilustrasi" label — the
      plugin below could only see images it never received. rehype-raw parses
      the HTML into real nodes first; it runs before our plugin, in order.
    */
    rehypePlugins: [rehypeRaw, rehypeResponsiveImages],
  },
  integrations: [
    svelte(),
    sitemap({
      /*
        Halaman yang mengirim noindex tidak boleh ikut di sitemap. Sitemap
        mengundang Google merayap, meta robots menyuruhnya pergi: dua dokumen
        yang saling menyangkal, dan hasilnya tumpuk URL "submitted and crawled,
        currently not indexed" yang mengaburkan index_rate halaman sungguhan di
        GSC. /thank-you/ adalah halaman konfirmasi setelah booking (noindex di
        halamannya sendiri); /agent/alt/ varian agen yang sengaja tidak di-index.
      */
      filter: (page) => !['/agent/alt/', '/thank-you/'].some((hidden) => page.endsWith(hidden)),
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
  image: {
    // Astro only handles inline <Image>; our media is pre-optimised by
    // scripts/optimize-media.mjs and served from /public/media.
    responsiveStyles: false,
  },
});
