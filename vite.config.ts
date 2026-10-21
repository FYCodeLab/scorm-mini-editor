import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// GitHub Pages serves this repo at /scorm-mini-editor/
export default defineConfig({
  base: '/scorm-mini-editor/',
  plugins: [react(), tailwindcss()],
})
