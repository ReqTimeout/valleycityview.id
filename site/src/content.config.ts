import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/collections/blog' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default('Tim Valley Cityview'),
    legacyUrl: z.string().optional(),
    wpId: z.number().optional(),
    status: z.enum(['publish', 'review', 'draft']).default('publish'),
    // Set from ../audit/posts.json (Fase 10 gate): duplicate-topic posts
    // 301 to their canonical post instead of rendering.
    redirectTo: z.string().optional(),
    cover: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
