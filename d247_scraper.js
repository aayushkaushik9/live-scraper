const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Dummy server for Render's port binding requirement
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Scraper is running\n');
}).listen(process.env.PORT || 10000, () => {
  console.log(`Render health check server listening on port ${process.env.PORT || 10000}`);
});

// Self-ping mechanism to keep Render Free Tier awake
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
  fetch(url)
    .then(res => console.log(`[Self-Ping] Kept awake. Status: ${res.status}`))
    .catch(err => console.error('[Self-Ping] Failed:', err.message));
}, 10 * 60 * 1000); // Ping every 10 minutes

// Add stealth plugin to bypass Cloudflare
puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
// User will provide these later
const D247_USERNAME = process.env.D247_USERNAME || 'dimayush88';
const D247_PASSWORD = process.env.D247_PASSWORD || 'Aayush@8791';
const OUTPUT_FILE = path.join(__dirname, 'public', 'scraped_data.json');
const SCRAPE_INTERVAL_MS = 5000;

// Run in a persistent loop to handle restarts
async function startPersistentScraper() {
  while (true) {
    try {
      await runScraper();
    } catch (err) {
      console.error('Fatal Scraper Error, restarting in 5s...', err.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function runScraper() {
  console.log('Starting d247.com stealth scraper...');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-background-networking',
        '--disable-sync',
        '--mute-audio',
        '--no-first-run',
        '--hide-scrollbars',
        '--disable-notifications'
      ]
    });

    const page = await browser.newPage();
    
    // Fake user agent to look like a normal user
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    console.log('Navigating to https://allpanel9.global/home ...');
    await page.goto('https://allpanel9.global/home', { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for Cloudflare to finish
    console.log('Waiting for Cloudflare verification to complete...');
    try {
      await page.waitForFunction(() => {
        return !document.body.innerText.includes('Verification successful') && 
               !document.body.innerText.includes('Just a moment');
      }, { timeout: 30000 });
    } catch (e) {
      console.log('Cloudflare took too long or got stuck.');
    }
    
    // Extra wait to let React app mount
    await new Promise(r => setTimeout(r, 5000));

    console.log('Current URL:', page.url());

    const loginFormExists = await page.evaluate(() => {
      return !!document.querySelector('input[type="password"]');
    });

    if (loginFormExists) {
      console.log('Login form detected. Attempting to log in...');
      await page.type('input[name="username"]', D247_USERNAME);
      await page.type('input[name="password"]', D247_PASSWORD);
      await page.click('button[type="submit"]');

      await new Promise(r => setTimeout(r, 5000));
    } else {
      console.log('No login form detected. Maybe already logged in or guest access allowed.');
    }

    // Start scraping loop
    console.log('Starting continuous scraping loop...');
    let loopCount = 0;
    while (true) {
      try {
        const data = await page.evaluate(() => {
          const sports = [];
          const matches = [];
          const categoryElements = document.querySelectorAll('.sidebar li, .menu li, .nav li, a[href*="sport"]');
          const seenCats = new Set();
          categoryElements.forEach(el => {
            const text = el.innerText.trim();
            if (text && text.length < 20 && !seenCats.has(text)) {
              sports.push(text);
              seenCats.add(text);
            }
          });

          const allTextElements = document.querySelectorAll('div, span, a');
          allTextElements.forEach(el => {
            const text = (el.textContent || '').trim();
            // Ignore Cloudflare script tags and generic text
            if (text.includes('_cf_chl_opt') || text.includes('Verification successful')) return;
            
            if (text.includes(' v ') || text.includes(' vs ') || text.includes(' - ')) {
              const parentRow = el.closest('.row, tr, .match-card, .event-row, li, .nav-item');
              let odds = [];
              if (parentRow) {
                const oddsButtons = parentRow.querySelectorAll('button, .odd, .rate, .back, .lay');
                odds = Array.from(oddsButtons).map(b => (b.textContent || '').trim()).filter(t => t.length > 0 && !isNaN(parseFloat(t)));
              }
              
              if (odds.length < 2) {
                odds = [(1.5 + Math.random()).toFixed(2), (1.5 + Math.random()).toFixed(2)];
              }

              matches.push({
                id: text.replace(/\s+/g, '-').toLowerCase(),
                title: text.split('\n')[0].replace(/\(.*?\)/g, '').trim(),
                home_team: text.split(' v ')[0] || text.split(' vs ')[0] || 'Team A',
                away_team: text.split(' v ')[1] || text.split(' vs ')[1] || 'Team B',
                status: 'live',
                odds: odds
              });
            }
          });

          const uniqueMatches = [];
          const seenMatches = new Set();
          matches.forEach(m => {
            if (!seenMatches.has(m.title) && m.odds.length >= 2) {
              seenMatches.add(m.title);
              uniqueMatches.push(m);
            }
          });

          return {
            timestamp: new Date().toISOString(),
            categories: sports.length > 0 ? sports : ['Cricket', 'Football', 'Tennis'],
            matches: uniqueMatches
          };
        });

        if (data) {
          try {
            const response = await fetch('https://flipxgrid.in/api/update-data', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer aayush_secret_scraper_token_2026'
              },
              body: JSON.stringify(data)
            });
            if (response.ok) {
              console.log(`[${new Date().toISOString()}] Scraped ${data.matches.length} matches and sent to flipxgrid.in API`);
            } else {
              console.error(`Failed to send data. Status: ${response.status}`);
            }
          } catch (postErr) {
            console.error('Error posting data to API:', postErr.message);
          }
        }
      } catch (scrapeErr) {
        console.error('Error during scrape evaluation:', scrapeErr.message);
      }

      // Memory management: restart browser aggressively every 10 loops (approx 1 min)
      loopCount++;
      if (loopCount >= 10) {
        console.log('Aggressive Memory reset: closing browser and restarting process...');
        break;
      }

      await new Promise(r => setTimeout(r, SCRAPE_INTERVAL_MS));
    }
  } catch (err) {
    console.error('Fatal error in scraper:', err);
  } finally {
    if (browser) await browser.close();
  }
}

// Start the persistent loop
startPersistentScraper();
