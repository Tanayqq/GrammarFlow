// Builds public/tailwind.css (npm run build:css). The page loads that file, not the Tailwind CDN.
module.exports = {
  content: ['./public/**/*.html', './public/*.js'],
  theme: { extend: { colors: { cosmic: { 900: '#080312', 800: '#13111c', 700: '#1f1d2b' } } } },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/container-queries')]
};
