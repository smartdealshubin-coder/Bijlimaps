import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const BijliMapApp = (function() {
    'use strict';

    // 1. Core Configuration (Preserving Firebase)
    const CONFIG = {
        firebase: {
            apiKey: "AIzaSyCKU2XkjjsCthNqIFWBFt_fi6bSpgVY1OM",
            authDomain: "bijlimap.firebaseapp.com",
            projectId: "bijlimap",
            storageBucket: "bijlimap.firebasestorage.app",
            messagingSenderId: "963833737121",
            appId: "1:963833737121:web:c4eaf67f1cb068dbb0e5e0",
            measurementId: "G-X8YRS24558"
        },
        api: { nominatimUrl: 'https://nominatim.openstreetmap.org' },
        map: { defaultCenter: [20.5937, 78.9629], defaultZoom: 5, detailZoom: 14 }
    };

    const app = initializeApp(CONFIG.firebase);
    const db = getFirestore(app);

    // 2. Utility & Performance Services
    const Utils = {
        debounce: (func, wait) => {
            let timeout;
            return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); };
        },
        timeAgo: (dateString) => {
            if (!dateString) return "Unknown";
            const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
            if (seconds < 60) return "Just now";
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${minutes}m ago`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours}h ago`;
            return new Date(dateString).toLocaleDateString();
        },
        getStatusColor: (status) => {
            const map = { 'Available': 'var(--c-green)', 'Power Outage': 'var(--c-red)', 'Voltage Issue': 'var(--c-orange)', 'Maintenance': 'var(--c-blue)' };
            return map[status] || 'var(--c-gray)';
        },
        getStatusClass: (status) => {
            const map = { 'Available': 'status-available', 'Power Outage': 'status-outage', 'Voltage Issue': 'status-voltage', 'Maintenance': 'status-maintenance' };
            return map[status] || 'status-unknown';
        }
    };

    // Educational Loading Messages
    class LoadingController {
        constructor() {
            this.el = document.getElementById('map-overlay-loader');
            this.textEl = document.getElementById('rotating-loading-text');
            this.messages = [
                "Fetching latest community reports...",
                "India's power grid serves millions every day.",
                "Community reports improve accuracy.",
                "Connecting to grid data..."
            ];
            this.interval = null;
        }
        show() {
            this.el.classList.remove('hidden');
            let i = 0;
            this.textEl.textContent = this.messages[0];
            this.interval = setInterval(() => {
                i = (i + 1) % this.messages.length;
                this.textEl.textContent = this.messages[i];
            }, 2000);
        }
        hide() {
            this.el.classList.add('hidden');
            clearInterval(this.interval);
        }
    }
    const Loader = new LoadingController();

    // 3. Bottom Sheet Controller (Mobile UX)
    class BottomSheet {
        constructor() {
            this.sheet = document.getElementById('bottom-sheet');
            this.handle = document.getElementById('drag-handle');
            this.isDragging = false;
            this.startY = 0;
            this.currentY = 0;
            
            // Heights
            this.peekHeight = 120; // shows search bar and title
            this.fullHeight = window.innerHeight * 0.85;
            
            // State: 0 = peek, 1 = full
            this.state = 0; 
            
            if (window.innerWidth < 900) this.initMobile();
            window.addEventListener('resize', Utils.debounce(() => this.handleResize(), 200));
        }

        initMobile() {
            this.setY(window.innerHeight - this.peekHeight);
            
            this.handle.addEventListener('touchstart', (e) => this.dragStart(e), {passive: true});
            window.addEventListener('touchmove', (e) => this.drag(e), {passive: false});
            window.addEventListener('touchend', () => this.dragEnd());
        }

        handleResize() {
            if (window.innerWidth >= 900) {
                this.sheet.style.transform = 'none';
            } else {
                this.fullHeight = window.innerHeight * 0.85;
                this.snapTo(this.state);
            }
        }

        dragStart(e) {
            this.isDragging = true;
            this.startY = e.touches[0].clientY - this.currentY;
            this.sheet.style.transition = 'none';
        }

        drag(e) {
            if (!this.isDragging) return;
            // Prevent scrolling underlying page
            if (e.cancelable) e.preventDefault(); 
            this.currentY = e.touches[0].clientY - this.startY;
            // Clamp
            const minY = window.innerHeight - this.fullHeight;
            const maxY = window.innerHeight - this.peekHeight;
            this.currentY = Math.max(minY, Math.min(this.currentY, maxY));
            this.sheet.style.transform = `translateY(${this.currentY}px)`;
        }

        dragEnd() {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.sheet.style.transition = 'transform var(--transition-smooth)';
            
            const threshold = window.innerHeight - (this.fullHeight / 2);
            if (this.currentY < threshold) this.snapTo(1);
            else this.snapTo(0);
        }

        snapTo(state) {
            this.state = state;
            const y = state === 1 ? (window.innerHeight - this.fullHeight) : (window.innerHeight - this.peekHeight);
            this.currentY = y;
            this.sheet.style.transform = `translateY(${y}px)`;
        }
        
        expand() { if(window.innerWidth < 900) this.snapTo(1); }
        collapse() { if(window.innerWidth < 900) this.snapTo(0); }
    }

    // 4. Map Service
    class MapService {
        constructor() {
            this.map = L.map('map-view', { zoomControl: false }).setView(CONFIG.map.defaultCenter, CONFIG.map.defaultZoom);
            L.control.zoom({ position: window.innerWidth > 900 ? 'bottomright' : 'topright' }).addTo(this.map);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this.map);
            this.marker = null;
        }

        setMarker(lat, lon, status) {
            if (this.marker) this.map.removeLayer(this.marker);
            const statusClass = Utils.getStatusClass(status);
            
            const icon = L.divIcon({ 
                className: `custom-marker ${statusClass}`, 
                html: '<div class="marker-ring"></div><div class="marker-pin"></div>', 
                iconSize: [20, 20], iconAnchor: [10, 10] 
            });
            
            this.marker = L.marker([lat, lon], { icon }).addTo(this.map);
            this.map.flyTo([lat, lon], CONFIG.map.detailZoom, { animate: true, duration: 1.5 });
        }
    }

    // 5. Database Service (Optimized for Timeline)
    class DatabaseService {
        static async saveReport(locName, lat, lon, status, reporter) {
            await addDoc(collection(db, "reports"), { locationName: locName, lat, lon, status, reporterName: reporter, timestamp: new Date().toISOString() });
        }

        static async getLocationHistory(locName) {
            // Optimized query: limit to 5 recent reports for timeline
            const q = query(collection(db, "reports"), where("locationName", "==", locName), orderBy("timestamp", "desc"), limit(5));
            const snapshot = await getDocs(q);
            let reports = [];
            snapshot.forEach(doc => reports.push(doc.data()));
            return reports;
        }
    }

    // 6. Main Controller
    class AppController {
        constructor() {
            this.Map = new MapService();
            this.Sheet = new BottomSheet();
            this.currentLoc = null;
            this.bindEvents();
        }

        bindEvents() {
            // Navigation
            document.querySelectorAll('[data-target]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
                    document.getElementById(`view-${btn.dataset.target}`).classList.add('active');
                    if(btn.dataset.target === 'dashboard') setTimeout(() => this.Map.map.invalidateSize(), 300);
                });
            });

            // Mobile menu
            document.getElementById('mobile-menu-btn').addEventListener('click', () => {
                document.getElementById('header-nav').classList.toggle('open');
            });

            // Search Logic (Debounced)
            const searchInput = document.getElementById('search-input');
            searchInput.addEventListener('focus', () => this.Sheet.expand());
            searchInput.addEventListener('input', Utils.debounce(async (e) => {
                const queryStr = e.target.value;
                if(queryStr.length < 3) return document.getElementById('search-dropdown').classList.add('hidden');
                
                document.getElementById('search-dropdown').classList.remove('hidden');
                const res = await fetch(`${CONFIG.api.nominatimUrl}/search?format=json&q=${encodeURIComponent(queryStr)}&countrycodes=in&limit=4`);
                const data = await res.json();
                
                const resultsEl = document.getElementById('search-results');
                resultsEl.innerHTML = '';
                data.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.textContent = item.display_name.split(',')[0] + ', ' + (item.address?.state || '');
                    div.onclick = () => {
                        document.getElementById('search-dropdown').classList.add('hidden');
                        searchInput.value = '';
                        this.selectLocation(item.name || item.display_name.split(',')[0], item.lat, item.lon);
                    };
                    resultsEl.appendChild(div);
                });
            }, 400));

            // GPS
            document.getElementById('btn-gps-fab').addEventListener('click', () => {
                if(!navigator.geolocation) return alert('GPS unsupported');
                Loader.show();
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    const res = await fetch(`${CONFIG.api.nominatimUrl}/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=14`);
                    const data = await res.json();
                    this.selectLocation(data.name || "Current Location", pos.coords.latitude, pos.coords.longitude);
                });
            });

            // Modals
            const modal = document.getElementById('modal-report');
            document.getElementById('btn-report-fab').addEventListener('click', () => {
                if(!this.currentLoc) return alert('Search a location first.');
                document.getElementById('form-report').reset();
                modal.showModal();
            });
            document.querySelectorAll('[data-action="close-modal"]').forEach(b => b.onclick = () => modal.close());
            
            document.getElementById('form-report').addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(e.target);
                await DatabaseService.saveReport(this.currentLoc.name, this.currentLoc.lat, this.currentLoc.lon, fd.get('power_status'), fd.get('reporter_name'));
                modal.close();
                this.selectLocation(this.currentLoc.name, this.currentLoc.lat, this.currentLoc.lon); // Refresh
            });
        }

        async selectLocation(name, lat, lon) {
            this.currentLoc = { name, lat, lon };
            document.getElementById('data-location').textContent = name;
            document.getElementById('modal-loc-name').textContent = name;
            
            this.Sheet.collapse(); // UX: Map focus
            Loader.show();

            const reports = await DatabaseService.getLocationHistory(name);
            Loader.hide();

            const emptyState = document.getElementById('empty-state');
            const timelineContainer = document.getElementById('timeline-container');
            const timeline = document.getElementById('report-timeline');
            const mainBadge = document.getElementById('badge-main-status');

            if(reports.length === 0) {
                emptyState.classList.remove('hidden');
                timelineContainer.classList.add('hidden');
                mainBadge.textContent = 'Unknown';
                mainBadge.className = 'status-badge badge-neutral';
                this.Map.setMarker(lat, lon, 'Unknown');
                return;
            }

            emptyState.classList.add('hidden');
            timelineContainer.classList.remove('hidden');
            timeline.innerHTML = '';
            
            // Build Timeline
            reports.forEach((r, idx) => {
                const li = document.createElement('li');
                li.className = 'timeline-item';
                li.innerHTML = `
                    <div class="timeline-dot" style="background-color: ${Utils.getStatusColor(r.status)}"></div>
                    <div class="timeline-content">
                        <span class="tl-status" style="color: ${Utils.getStatusColor(r.status)}">${r.status}</span>
                        <span class="tl-meta">${Utils.timeAgo(r.timestamp)} by ${r.reporterName}</span>
                    </div>
                `;
                timeline.appendChild(li);
            });

            // Update main status
            const latest = reports[0].status;
            mainBadge.textContent = latest;
            mainBadge.className = `status-badge ${latest === 'Available' ? 'badge-green' : latest === 'Power Outage' ? 'badge-red' : latest === 'Voltage Issue' ? 'badge-orange' : 'badge-blue'}`;
            this.Map.setMarker(lat, lon, latest);
        }
    }

    return { init: () => new AppController() };
})();

document.addEventListener('DOMContentLoaded', BijliMapApp.init);
