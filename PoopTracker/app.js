/* ============================================
   Poop Tracker — App Logic
   ============================================ */

// --- Data ---
const foodItems = [
  { id: 1, name: "Everything Bagel", brand: "Better Goods", servingSize: "1 Bagel", servings: 1, time: "8:02", period: "AM", kcal: 230, carb: 30, pro: 8, fat: 7 },
  { id: 2, name: "Avocado", brand: "Generic", servingSize: "1 Avocado", servings: 1, time: "8:03", period: "AM", kcal: 240, carb: 13, pro: 3, fat: 22 },
  { id: 3, name: "Cinnamon Oatmeal", brand: "Great Value", servingSize: "1 Packet", servings: 2, time: "10:16", period: "AM", kcal: 130, carb: 27, pro: 3, fat: 2 },
  { id: 4, name: "Strawberry Yogurt", brand: "Chobani", servingSize: "1 Cup", servings: 1, time: "10:20", period: "AM", kcal: 110, carb: 15, pro: 11, fat: 0 },
];

const dailyGoals = { kcal: 2300, carb: 294, pro: 135, fat: 65 };
const dailyTotals = { kcal: 1050, carb: 85, pro: 25, fat: 22 };

const weekData = [-200, -200, 80, 100, -100, -100, -190];
const weekAvg = -87;

// --- DOM ---
const pages = document.getElementById('pages');
const navBtns = document.querySelectorAll('.nav-btn');
const menuItems = document.querySelectorAll('.menu-item');
const foodListView = document.getElementById('food-list-view');
const foodDetailView = document.getElementById('food-detail-view');
const foodList = document.getElementById('food-list');
const detailContent = document.getElementById('detail-content');
const btnBack = document.getElementById('btn-back');
const btnHome = document.getElementById('btn-home');
const digestionList = document.getElementById('digestion-list');
const progressFoodList = document.getElementById('progress-food-list');
const dayView = document.getElementById('day-view');
const weekView = document.getElementById('week-view');
const toggleBtns = document.querySelectorAll('.toggle-btn');

let currentPage = 0;

// --- Toilet Icon SVG (reusable) ---
const toiletSVG = `<i data-lucide="toilet"></i>`;

// --- Navigation ---
function goToPage(index) {
  currentPage = index;
  const target = pages.children[index];
  if (target) {
    target.scrollIntoView({ behavior: 'smooth' });
  }
  updateNav(index);
}

function updateNav(index) {
  navBtns.forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });
}

// Intersection Observer to track which page is visible
const pageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
      const idx = Array.from(pages.children).indexOf(entry.target);
      if (idx >= 0) {
        currentPage = idx;
        updateNav(idx);
      }
    }
  });
}, { root: pages, threshold: 0.5 });

// --- Render Food List ---
function renderFoodList() {
  foodList.innerHTML = foodItems.map(item => `
    <div class="food-item-card" data-id="${item.id}">
      <div class="food-info">
        <div class="food-brand">${item.brand}</div>
        <div class="food-name">${item.name}</div>
      </div>
      <div class="food-macros">
        <div class="macro macro-kcal">
          <div class="macro-label">KCAL</div>
          <div class="macro-value">${item.kcal}</div>
        </div>
        <div class="macro macro-carb">
          <div class="macro-label">CARB</div>
          <div class="macro-value">${item.carb}g</div>
        </div>
        <div class="macro macro-pro">
          <div class="macro-label">PRO</div>
          <div class="macro-value">${item.pro}g</div>
        </div>
        <div class="macro macro-fat">
          <div class="macro-label">FAT</div>
          <div class="macro-value">${item.fat}g</div>
        </div>
      </div>
    </div>
  `).join('');

  foodList.querySelectorAll('.food-item-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.id);
      showFoodDetail(id);
    });
  });
}

// --- Food Detail ---
function showFoodDetail(id) {
  const item = foodItems.find(f => f.id === id);
  if (!item) return;

  const totalKcal = item.kcal * item.servings;
  const totalCarb = item.carb * item.servings;
  const totalPro = item.pro * item.servings;
  const totalFat = item.fat * item.servings;

  detailContent.innerHTML = `
    <div class="detail-card">
      <div class="food-name">${item.name}</div>
      <div class="food-brand">${item.brand}</div>
      <div class="detail-body">
        <div class="detail-fields">
          <div class="field-group">
            <label>Serving Size</label>
            <div class="field-value">${item.servingSize}</div>
          </div>
          <div class="field-group">
            <label>No. Servings</label>
            <div class="field-value">${item.servings}</div>
          </div>
          <div class="field-group">
            <label>Time Consumed</label>
            <div class="field-value">${item.time}${item.period}</div>
          </div>
          <button class="btn-add" id="btn-add-${item.id}">ADD</button>
        </div>
        <div class="detail-bars">
          <div class="detail-bars-header">Daily Goal</div>
          ${renderDetailBar('Calories (kcal)', 'kcal', totalKcal, dailyGoals.kcal)}
          ${renderDetailBar('Carbohydrates (g)', 'carb', totalCarb, dailyGoals.carb)}
          ${renderDetailBar('Protein (g)', 'pro', totalPro, dailyGoals.pro)}
          ${renderDetailBar('Fat (g)', 'fat', totalFat, dailyGoals.fat)}
        </div>
      </div>
    </div>
  `;

  // ADD button handler
  const addBtn = document.getElementById(`btn-add-${item.id}`);
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addBtn.textContent = 'ADDED!';
      addBtn.classList.add('added');
    });
  }

  foodListView.classList.add('hidden');
  foodDetailView.classList.remove('hidden');
  foodDetailView.classList.add('fade-in');
}

function renderDetailBar(label, type, value, goal) {
  const pct = Math.min((value / goal) * 100, 100);
  return `
    <div class="bar-group">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill ${type}" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function showFoodList() {
  foodDetailView.classList.add('hidden');
  foodDetailView.classList.remove('fade-in');
  foodListView.classList.remove('hidden');
  foodListView.classList.add('fade-in');
}

// --- Render Digestion List ---
function renderDigestionList() {
  digestionList.innerHTML = foodItems.map(item => `
    <div class="digestion-card" data-id="${item.id}">
      <div class="digestion-time">${item.time}<span>${item.period}</span></div>
      <div class="digestion-info">
        <div class="food-brand">${item.brand}</div>
        <div class="food-name">${item.name}</div>
      </div>
      <button class="btn-toilet" data-id="${item.id}">${toiletSVG}</button>
    </div>
  `).join('');

  // Re-initialize Lucide icons for dynamically added elements
  if (window.lucide) lucide.createIcons();

  digestionList.querySelectorAll('.btn-toilet').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      goToPage(1);
      setTimeout(() => showFoodDetail(id), 400);
    });
  });
}

// --- Render Progress Food List ---
function renderProgressFoodList() {
  progressFoodList.innerHTML = foodItems.map(item => `
    <div class="progress-food-card">
      <div class="progress-time">${item.time}<span>${item.period}</span></div>
      <div class="progress-food-info">
        <div class="food-brand">${item.brand}</div>
        <div class="food-name">${item.name}</div>
      </div>
      <div class="progress-kcal">
        <div class="macro-label">KCAL</div>
        <div class="macro-value">${item.kcal * item.servings}</div>
      </div>
    </div>
  `).join('');
}

// --- Render Day Progress Bars ---
function renderDayView() {
  const bars = [
    { label: 'Calories', type: 'kcal', value: dailyTotals.kcal, goal: dailyGoals.kcal, unit: 'kcal' },
    { label: 'Carbohydrates', type: 'carb', value: dailyTotals.carb, goal: dailyGoals.carb, unit: 'g' },
    { label: 'Protein', type: 'pro', value: dailyTotals.pro, goal: dailyGoals.pro, unit: 'g' },
    { label: 'Fat', type: 'fat', value: dailyTotals.fat, goal: dailyGoals.fat, unit: 'g' },
  ];

  dayView.innerHTML = bars.map(b => {
    const pct = Math.min((b.value / b.goal) * 100, 100);
    return `
      <div class="progress-bar-group">
        <div class="progress-bar-header">
          <span>${b.label}</span>
          <span>Daily Goal</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill ${b.type}" style="width:${pct}%"></div>
        </div>
        <div class="progress-bar-values">
          <span class="current">${b.value} ${b.unit}</span>
          <span>${b.goal} ${b.unit}</span>
        </div>
      </div>
    `;
  }).join('');
}


// --- Render Week Chart ---
function renderWeekChart() {
  const w = 450, h = 250;
  const padL = 40, padR = 10, padT = 30, padB = 40;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  
  // Weekly data: [M, T, W, T, F, S, S]
  const weekValues = [1820, 1950, 1720, 2100, 1890, 2200, 2010]; // Mocked based on average
  const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const maxVal = 2500;

  let svg = `<svg viewBox="0 0 ${w} ${h}" class="week-chart-svg">`;
  
  // Horizontal grid lines
  for (let i = 0; i <= 5; i++) {
    const val = i * 500;
    const y = padT + chartH * (1 - val / maxVal);
    svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#ddd" stroke-width="1"/>`;
    svg += `<text x="${padL - 6}" y="${y + 2.5}" text-anchor="end" fill="#999" font-size="8">${val}</text>`;
  }

  // Cylindrical Bars
  const barW = 24;
  const slotW = chartW / 7;
  
  weekValues.forEach((val, i) => {
    const x = padL + (i * slotW) + (slotW / 2);
    const barH = (val / maxVal) * chartH;
    const yEnd = h - padB;
    const yTop = yEnd - barH;
    
    // Background slot (lighter)
    svg += `<rect x="${x - barW/2}" y="${padT}" width="${barW}" height="${chartH}" rx="${barW/2}" ry="${barW/4}" class="week-bar-bg" fill="#ecebea" />`;
    
    // Fill Bar (Cylinder)
    svg += `<rect x="${x - barW/2}" y="${yTop}" width="${barW}" height="${barH}" rx="${barW/2}" ry="${barW/4}" class="week-bar-fill" fill="#11c9e9" />`;
    
    // Top Ellipse of cylinder for 3D effect
    svg += `<ellipse cx="${x}" cy="${yTop}" rx="${barW/2}" ry="${barW/4}" class="week-bar-top" fill="#2fd8f4" />`;
    
    // Label
    svg += `<text x="${x}" y="${h - 12}" text-anchor="middle" fill="#888" font-size="9" font-weight="700">${labels[i]}</text>`;
  });

  svg += `</svg>`;
  weekView.innerHTML = `<div class="week-chart-container">${svg}</div>`;
}


// --- Touch / Swipe Handling ---
let touchStartY = 0;
let touchStartTime = 0;

pages.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: true });

pages.addEventListener('touchend', (e) => {
  const deltaY = touchStartY - e.changedTouches[0].clientY;
  const deltaTime = Date.now() - touchStartTime;

  if (Math.abs(deltaY) > 50 && deltaTime < 500) {
    if (deltaY > 0 && currentPage < 3) {
      goToPage(currentPage + 1);
    } else if (deltaY < 0 && currentPage > 0) {
      goToPage(currentPage - 1);
    }
  }
}, { passive: true });

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' && currentPage < 3) {
    e.preventDefault();
    goToPage(currentPage + 1);
  } else if (e.key === 'ArrowUp' && currentPage > 0) {
    e.preventDefault();
    goToPage(currentPage - 1);
  }
});

// --- Event Listeners ---
navBtns.forEach((btn, i) => {
  btn.addEventListener('click', () => goToPage(i));
});

menuItems.forEach(item => {
  item.addEventListener('click', () => {
    const target = parseInt(item.dataset.goto);
    goToPage(target);
  });
});

btnBack.addEventListener('click', showFoodList);
btnHome.addEventListener('click', () => goToPage(0));

toggleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    toggleBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    if (view === 'day') {
      dayView.classList.remove('hidden');
      weekView.classList.add('hidden');
    } else {
      dayView.classList.add('hidden');
      weekView.classList.remove('hidden');
    }
  });
});

// --- Init ---
function init() {
  Array.from(pages.children).forEach(page => pageObserver.observe(page));
  renderFoodList();
  renderDigestionList();
  renderProgressFoodList();
  renderDayView();
  renderWeekChart();
  updateNav(0);

  // Initialize Lucide icons
  if (window.lucide) {
    lucide.createIcons();
  }
}

document.addEventListener('DOMContentLoaded', init);
