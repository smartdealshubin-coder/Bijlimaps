import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const BijliMapApp = (function() {
    'use strict';

    // ==========================================
    // 1. CONFIGURATION (Preserved Firebase)
    // ==========================================
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
        map: { defaultCenter: [20.5937, 78.9629], defaultZoom: 5, detailZoom: 15 }
    };

    const app = initializeApp(CONFIG.firebase);
    const db = getFirestore(app);

    // ==========================================
    // 2. UTILITY & UI SERVICES
    // ==========================================
    const Utils = {
        debounce: (func, wait) => {
            let timeout;
            return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func(...args), wait); };
        },
        timeAgo: (dateString) => {
            if (!dateString) return "Just now";
            const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
            if (seconds < 60) return "Just now";
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${minutes}m ago`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours}h ago`;
            return new Date(dateString).toLocaleDateString();
        },
        getStatusColor: (status) => {
            const colors = { 'Available': 'var(--c-green)', 'Power Outage': 'var(--c-red)', 'Voltage Issue': 'var(--c-orange)', 'Maintenance': 'var(--c-blue)' };
            return colors[status] || 'var(--c-neutral)';
        },
        getBadgeClass: (status) => {
            const classes = { 'Available': 'badge-green', 'Power Outage': 'badge-red', 'Voltage Issue': 'badge-orange', 'Maintenance': 'badge-blue' };
            return classes[status] || 'badge-neutral';
        }
    };

    class NotificationService {
        constructor() { this.container = document.getElementById('toast-container'); }
        show(message, type = 'info', duration = 4000) {
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : '💡';
            toast.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span><div class="font-semibold text-sm">${this.escapeHTML(message)}</div>`;
            this.container.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
        }
        escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
    }
    const Notify = new NotificationService();

    // ==========================================
    // 3. OFFLINE SYNC & DATABASE (REALTIME)
    // ==========================================
    class DatabaseService {
        constructor() { this.unsubscribe = null; }

        async saveReport(locName, lat, lon, status, reporter) {
            const reportData = { locationName: locName, lat, lon, status, reporterName: reporter, timestamp: new Date().toISOString() };
            
            if (!navigator.onLine) {
                const queue = JSON.parse(localStorage.getItem('offlineReports') || '[]');
                queue.push(reportData);
                localStorage.setItem('offlineReports', JSON.stringify(queue));
                Notify.show('Offline: Report queued securely.', 'info');
                return;
            }

            try {
                await addDoc(collection(db, "reports"), { ...reportData, serverTime: serverTimestamp() });
                Notify.show('Report broadcasted to grid.', 'success');
            } catch (e) {
                console.error(e);
                Notify.show('Failed to save report.', 'error');
            }
        }

        async syncOfflineReports() {
            const queue = JSON.parse(localStorage.getItem('offlineReports') || '[]');
            if (queue.length === 0) return;
            
            Notify.show(`Syncing ${queue.length} offline reports...`, 'info');
            for (let report of queue) {
                try {
                    await addDoc(collection(db, "reports"), report);
                } catch (e) { console.error("Sync failed for", report); }
            }
            localStorage.removeItem('offlineReports');
            Notify.show('Offline reports synced successfully.', 'success');
        }

        // Phase 7 Realtime Listener
        subscribeToLocation(locName, callback) {
            if (this.unsubscribe) this.unsubscribe(); // Cleanup previous listener
            
            const q = query(collection(db, "reports"), where("locationName", "==", locName), orderBy("timestamp", "desc"), limit(20));
            this.unsubscribe = onSnapshot(q, (snapshot) => {
                const reports = [];
                snapshot.forEach(doc => reports.push(doc.data()));
                callback(reports);
            }, (error) => {
                console.error("Realtime listen failed:", error);
                Notify.show('Connection to live grid lost.', 'error');
            });
        }
    }
    const DB = new DatabaseService();

    // ==========================================
    // 4. MAP & LOCATION SYSTEM
    // ==========================================
    class MapService {
        constructor() {
            this.map = L.map('map-view', { zoomControl: false }).setView(CONFIG.map.defaultCenter, CONFIG.map.defaultZoom);
            L.control.zoom({ position: window.innerWidth > 900 ? 'bottomright' : 'topright' }).addTo(this.map);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(this.map);
            
            this.statusMarker = null;
            this.userMarkerGroup = L.layerGroup().addTo(this.map);
        }

        setStatusMarker(lat, lon, status) {
            if (this.statusMarker) this.map.removeLayer(this.statusMarker);
            
            const iconHTML = `<div class="marker-wrapper status-${status.replace(' ', '')}"><div class="marker-core"></div></div>`;
            const icon = L.divIcon({ className: 'custom-leaflet-marker', html: iconHTML, iconSize: [30, 30], iconAnchor: [15, 15] });
            
            this.statusMarker = L.marker([lat, lon], { icon }).addTo(this.map);
            this.map.flyTo([lat, lon], CONFIG.map.detailZoom, { animate: true, duration: 1.5 });
        }

        updateUserLocation(lat, lon, accuracy) {
            this.userMarkerGroup.clearLayers();
            
            // Accuracy Circle
            L.circle([lat, lon], { radius: accuracy, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.1, weight: 1 }).addTo(this.userMarkerGroup);
            
            // Blue Dot
            const icon = L.divIcon({ className: 'user-dot-container', html: '<div class="user-accuracy-ring"></div><div class="user-dot"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
            L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(this.userMarkerGroup);
            
            this.map.flyTo([lat, lon], CONFIG.map.detailZoom, { animate: true, duration: 1.2 });
        }
    }

    // ==========================================
    // 5. BOTTOM SHEET (MOBILE UX)
    // ==========================================
    class BottomSheet {
        constructor() {
            this.panel = document.getElementById('main-panel');
            this.handle = document.getElementById('drag-handle');
            this.isMobile = window.innerWidth < 900;
            this.state = 0; // 0 = peek, 1 = full
            
            if (this.isMobile) this.initMobile();
            window.addEventListener('resize', Utils.debounce(() => {
                this.isMobile = window.innerWidth < 900;
                if (!this.isMobile) this.panel.style.transform = 'none';
                else this.snapTo(this.state);
            }, 200));
        }

        initMobile() {
            let startY = 0, currentY = 0, isDragging = false;
            const peekY = window.innerHeight - 200;
            const fullY = window.innerHeight * 0.15;
            this.snapTo(0);

            this.handle.addEventListener('touchstart', e => { isDragging = true; startY = e.touches[0].clientY - currentY; this.panel.style.transition = 'none'; }, {passive: true});
            window.addEventListener('touchmove', e => {
                if (!isDragging) return;
                currentY = Math.max(fullY, Math.min(e.touches[0].clientY - startY, peekY));
                this.panel.style.transform = `translateY(${currentY}px)`;
            }, {passive: true});
            window.addEventListener('touchend', () => {
                if (!isDragging) return;
                isDragging = false;
                this.panel.style.transition = 'transform var(--trans-smooth)';
                this.snapTo(currentY < (window.innerHeight / 2) ? 1 : 0);
            });
        }

        snapTo(state) {
            this.state = state;
            if (this.isMobile) {
                const y = state === 1 ? window.innerHeight * 0.15 : window.innerHeight - 200;
                this.panel.style.transform = `translateY(${y}px)`;
            }
        }
    }

    // ==========================================
    // 6. MAIN APPLICATION CONTROLLER
    // ==========================================
    class AppController {
        constructor() {
            this.Map = new MapService();
            this.Sheet = new BottomSheet();
            this.currentContext = { name: null, lat: null, lon: null };
            
            this.cacheDOM();
            this.bindEvents();
            this.initNetworkHandling();
            
            // Prefill reporter name from local storage if exists (Value-driven context handling)
            const savedName = localStorage.getItem('bijlimap_reporter_name') || 'Abhinav Singh'; 
            document.getElementById('reporter_name').value = savedName;
        }

        cacheDOM() {
            this.DOM = {
                searchInput: document.getElementById('search-input'),
                searchDropdown: document.getElementById('search-dropdown'),
                searchResults: document.getElementById('search-results'),
                searchLoader: document.getElementById('search-loader'),
                
                initialState: document.getElementById('initial-state'),
                uiSkeleton: document.getElementById('ui-skeleton'),
                liveStatusView: document.getElementById('live-status-view'),
                emptyState: document.getElementById('empty-state'),
                timelineContainer: document.getElementById('timeline-container'),
                
                locNameText: document.getElementById('data-location'),
                mainBadge: document.getElementById('badge-main-status'),
                timelineList: document.getElementById('report-timeline'),
                reportCount: document.getElementById('data-report-count'),
                
                modal: document.getElementById('modal-report'),
                modalForm: document.getElementById('form-report'),
                modalLocName: document.getElementById('modal-loc-name'),
                btnSubmitReport: document.getElementById('btn-submit-report')
            };
        }

        bindEvents() {
            // Search (Debounced Nominatim Request)
            this.DOM.searchInput.addEventListener('input', Utils.debounce(async (e) => {
                const query = e.target.value.trim();
                if(query.length < 3) return this.DOM.searchDropdown.classList.add('hidden');
                
                this.DOM.searchLoader.classList.remove('hidden');
                this.DOM.searchDropdown.classList.remove('hidden');
                
                try {
                    const res = await fetch(`${CONFIG.api.nominatimUrl}/search?format=json&q=${encodeURIComponent(query)}&countrycodes=in&limit=5`);
                    const data = await res.json();
                    
                    this.DOM.searchResults.innerHTML = '';
                    if(data.length === 0) {
                        this.DOM.searchResults.innerHTML = '<div class="p-3 text-center text-muted">No locations found.</div>';
                    } else {
                        data.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'search-result-item';
                            div.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="text-muted"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> <span>${item.display_name.split(',')[0]}, ${item.address?.state || ''}</span>`;
                            div.onclick = () => {
                                this.DOM.searchDropdown.classList.add('hidden');
                                this.DOM.searchInput.value = '';
                                this.loadLocationData(item.name || item.display_name.split(',')[0], parseFloat(item.lat), parseFloat(item.lon));
                            };
                            this.DOM.searchResults.appendChild(div);
                        });
                    }
                } catch(err) { console.error("Search failed"); }
                this.DOM.searchLoader.classList.add('hidden');
            }, 500));

            // Close search on outside click
            document.addEventListener('click', (e) => { if (!e.target.closest('.search-module')) this.DOM.searchDropdown.classList.add('hidden'); });

            // GPS Location
            document.getElementById('btn-gps-fab').addEventListener('click', () => {
                if (!navigator.geolocation) return Notify.show('GPS not supported by device.', 'error');
                
                Notify.show('Acquiring high-accuracy satellite lock...', 'info');
                navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                        const { latitude, longitude, accuracy } = pos.coords;
                        this.Map.updateUserLocation(latitude, longitude, accuracy);
                        
                        // Reverse geocode to get area name
                        try {
                            const res = await fetch(`${CONFIG.api.nominatimUrl}/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14`);
                            const data = await res.json();
                            const locName = data.name || data.address?.city || data.address?.village || "Current Location";
                            this.loadLocationData(locName, latitude, longitude);
                        } catch(e) { Notify.show('Failed to resolve area name.', 'error'); }
                    },
                    (err) => {
                        if (err.code === 1) Notify.show('Location access denied. Please enable permissions.', 'error');
                        else Notify.show('GPS signal lost. Try searching manually.', 'error');
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            });

            // Report Modal Logic
            document.getElementById('btn-report-fab').addEventListener('click', () => {
                if (!this.currentContext.name) return Notify.show('Please search or select a location first.', 'error');
                this.DOM.modalLocName.textContent = this.currentContext.name;
                this.DOM.modal.showModal();
            });

            document.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.onclick = () => this.DOM.modal.close());

            this.DOM.modalForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = this.DOM.btnSubmitReport;
                btn.disabled = true; btn.textContent = 'Authenticating...';
                
                const formData = new FormData(this.DOM.modalForm);
                const status = formData.get('power_status');
                const reporter = formData.get('reporter_name');
                
                // Save name for future convenience
                localStorage.setItem('bijlimap_reporter_name', reporter);
                
                await DB.saveReport(this.currentContext.name, this.currentContext.lat, this.currentContext.lon, status, reporter);
                
                this.DOM.modal.close();
                btn.disabled = false; btn.textContent = 'Submit Update';
            });
        }

        initNetworkHandling() {
            const banner = document.getElementById('offline-banner');
            window.addEventListener('offline', () => banner.classList.remove('hidden'));
            window.addEventListener('online', () => {
                banner.classList.add('hidden');
                DB.syncOfflineReports();
            });
            if (!navigator.onLine) banner.classList.remove('hidden');
        }

        // ==========================================
        // UI STATE MANAGEMENT & REALTIME RENDER
        // ==========================================
        loadLocationData(name, lat, lon) {
            this.currentContext = { name, lat, lon };
            this.Sheet.snapTo(1); // Expand sheet on mobile
            
            this.DOM.initialState.classList.add('hidden');
            this.DOM.liveStatusView.classList.add('hidden');
            this.DOM.uiSkeleton.classList.remove('hidden');

            // Phase 7: Realtime Subscription updates UI instantly on change
            DB.subscribeToLocation(name, (reports) => {
                this.DOM.uiSkeleton.classList.add('hidden');
                this.DOM.liveStatusView.classList.remove('hidden');
                this.DOM.locNameText.textContent = name;
                
                if (reports.length === 0) {
                    this.DOM.emptyState.classList.remove('hidden');
                    this.DOM.timelineContainer.classList.add('hidden');
                    this.DOM.mainBadge.textContent = 'Unknown';
                    this.DOM.mainBadge.className = 'status-badge badge-neutral';
                    this.Map.setStatusMarker(lat, lon, 'Unknown');
                    return;
                }

                this.DOM.emptyState.classList.add('hidden');
                this.DOM.timelineContainer.classList.remove('hidden');
                
                // Update Main Status Card (Latest Report)
                const latest = reports[0];
                this.DOM.mainBadge.textContent = latest.status;
                this.DOM.mainBadge.className = `status-badge ${Utils.getBadgeClass(latest.status)}`;
                this.DOM.reportCount.textContent = `${reports.length} Verified Update${reports.length>1?'s':''}`;
                
                this.Map.setStatusMarker(lat, lon, latest.status);

                // Build Timeline
                this.DOM.timelineList.innerHTML = '';
                reports.forEach(report => {
                    const li = document.createElement('li');
                    li.className = 'timeline-item';
                    li.innerHTML = `
                        <div class="timeline-dot" style="background-color: ${Utils.getStatusColor(report.status)}"></div>
                        <div class="tl-status" style="color: ${Utils.getStatusColor(report.status)}">${report.status}</div>
                        <div class="tl-meta">
                            <span class="font-semibold">${report.reporterName}</span>
                            <span>• ${Utils.timeAgo(report.timestamp)}</span>
                        </div>
                    `;
                    this.DOM.timelineList.appendChild(li);
                });
            });
        }
    }

    // Bootstrap Application
    return { init: () => new AppController() };
})();

document.addEventListener('DOMContentLoaded', BijliMapApp.init);
