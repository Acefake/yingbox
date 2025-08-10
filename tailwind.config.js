/** @type {import('tailwindcss').Config} */
import { iconsPlugin, getIconCollections } from '@egoist/tailwindcss-icons'

module.exports = {
  content: ['./src/**/*.{html,js,ts,vue}', './src/renderer/src/**/*.{html,js,ts,vue}'],
  theme: {
    extend: {},
  },
  plugins: [
    iconsPlugin({
      collections: getIconCollections(['heroicons', 'mdi']),
    }),
  ],
}
