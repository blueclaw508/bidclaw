import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.PORT || '5173'),
    strictPort: false,
  },
  build: {
    rollupOptions: {
      output: {
        // Split out the big third-party deps into their own chunks so they
        // can be cached independently and so the initial-load JS shrinks.
        // Route-level chunks are created automatically by Vite when route
        // components are dynamic-imported via React.lazy (see src/App.tsx).
        // React stays in the main bundle on purpose — it's imported by
        // every eager component, so a dedicated vendor-react chunk would
        // be empty (Rollup hoists react/react-dom into the chunk that
        // imports them most). The router/supabase/icons splits work
        // cleanly because those have narrower import graphs.
        manualChunks: {
          'vendor-router':   ['react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-icons':    ['lucide-react'],
          'vendor-dnd':      ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-dropzone': ['react-dropzone'],
        },
      },
    },
  },
})
