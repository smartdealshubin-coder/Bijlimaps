// script.js

/**
 * BijliMap - Phase 4 Architecture
 * Author: Principal SWE / JS Architect
 * Description: Clean, scalable ES6 module-like architecture. No frameworks.
 */

const BijliMapApp = (function() {
    'use strict';

    // ==========================================================================
    // Core Configuration
    // ==========================================================================
    const CONFIG = {
        api: {
            nominatimUrl: 'https://nominatim.openstreetmap.org',
            countryCodes: 'in', // Restrict to India
            userAgent: 'BijliMap_Phase4_App'
        },
        storageKeys: {
            recentSearches: 'bijlimap_recent_searches',
            lastLocation: 'bijlimap_last_location',
            userReports: 'bijlimap_user_reports'
        },
        map: {
            defaultCenter: [20.5937, 78.9629], // India
            defaultZoom: 5,
            detailZoom: 14
        },
        timeout: 10000 // 10 seconds for API requests
    };

    // ==========================================================================
    // Service: Local Storage
    // ==========================================================================
    class StorageService {
        static get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (e) {
                console.warn(`Error reading ${key} from localStorage`, e);
                return defaultValue;
            }
        }
        static set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.warn(`Error setting ${key} in localStorage`, e);
            }
        }
        static remove(key) {
            localStorage.removeItem(key);
        }
    }

    // ==========================================================================
    // Service: Notifications (Toasts)
    // ==========================================================================
    class NotificationService {
        constructor() {
            this.container = document.getElementById('toast-container');
        }
        
        show(title, message, type = 'info', duration = 4000) {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.setAttribute('role', 'alert');
            
            toast.innerHTML = `
                <div class="toast-title">${this.escapeHTML(title)}</div>
                <div class="toast-msg">${this.escapeHTML(message)}</div>
            `;
            
            this.container.appendChild(toast);
            
            setTimeout(() => {
                toast.classList.add('removing');
                toast.addEventListener('animationend', () => toast.remove());
            }, duration);
        }

        escapeHTML(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    }
    const Notify = new NotificationService();

    // ==========================================================================
    // Service: Utilities & Performance
    // ==========================================================================
    const Utils = {
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        generateMockStatus(lat, lon) {
            // Deterministic mock generation based on coordinates for Phase 4
            const seed = Math.abs(Math.sin(lat * lon)) * 100;
            if (seed > 80) return { type: 'outage', conf: '92%', count: 14, time: '5 mins ago', user: 'Community' };
            if (seed > 65) return { type: 'voltage', conf: '75%', count: 3, time: '1 hr ago', user: 'Verified' };
            if (seed > 55) return { type: 'maintenance', conf: '99%', count: 1, time: '2 hrs ago', user: 'Utility Board' };
            if (seed < 5) return { type: 'unknown', conf: '0%', count: 0, time: 'N/A', user: 'N/A' };
            return { type: 'available', conf: '98%', count: 42, time: 'Just now', user: 'System' };
        }
    };

    // ==========================================================================
    // Service: Interactive Map (Leaflet)
    // ==========================================================================
    class MapService {
        constructor() {
            this.map = null;
            this.currentMarker = null;
            this.currentCircle = null;
            this.init();
        }

        init() {
            try {
                const savedLoc = StorageService.get(CONFIG.storageKeys.lastLocation);
                const startCenter = savedLoc ? [savedLoc.lat, savedLoc.lon] : CONFIG.map.defaultCenter;
                const startZoom = savedLoc ? CONFIG.map.detailZoom : CONFIG.map.defaultZoom;

                this.map = L.map('map-view', { zoomControl: false }).setView(startCenter, startZoom);
                
                L.control.zoom({ position: 'bottomright' }).addTo(this.map);
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap',
                    maxZoom: 19
                }).addTo(this.map);

                if (savedLoc) this.setMarker(savedLoc.lat, savedLoc.lon, savedLoc.name);

            } catch (e) {
                document.getElementById('map-overlay-error').classList.remove('hidden');
                console.error("Map Initialization Failed:", e);
            }
        }

        setMarker(lat, lon, popupText) {
            if (this.currentMarker) this.map.removeLayer(this.currentMarker);
            if (this.currentCircle) this.map.removeLayer(this.currentCircle);

            const customIcon = L.divIcon({
                className: 'custom-pulse-marker',
                html: '<div class="pulse-ring"></div><div class="pulse-core"></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            this.currentMarker = L.marker([lat, lon], { icon: customIcon }).addTo(this.map);
            if (popupText) this.currentMarker.bindPopup(`<b>${popupText}</b>`).openPopup();
            
            // Highlight radius
            this.currentCircle = L.circle([lat, lon], {
                color: 'var(--c-brand-blue)',
                fillColor: 'var(--c-brand-blue)',
                fillOpacity: 0.1,
                radius: 1500 // 1.5km radius
            }).addTo(this.map);

            this.map.flyTo([lat, lon], CONFIG.map.detailZoom, { animate: true, duration: 1.5 });
        }
    }

    // ==========================================================================
    // Module: Geolocation & Search API
    // ==========================================================================
    class LocationAPI {
        constructor() {
            this.abortController = null;
        }

        async search(query) {
            if (this.abortController) this.abortController.abort();
            this.abortController = new AbortController();

            try {
                const url = `${CONFIG.api.nominatimUrl}/search?format=json&q=${encodeURIComponent(query)}&countrycodes=${CONFIG.api.countryCodes}&limit=5`;
                const response = await fetch(url, { signal: this.abortController.signal, headers: {'User-Agent': CONFIG.api.userAgent} });
                if (!response.ok) throw new Error('API Rate Limit or Error');
                return await response.json();
            } catch (error) {
                if (error.name === 'AbortError') return null; // Ignore aborted
                throw error;
            }
        }

        async reverseGeocode(lat, lon) {
            try {
                const url = `${CONFIG.api.nominatimUrl}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
                const response = await fetch(url, { headers: {'User-Agent': CONFIG.api.userAgent} });
                if (!response.ok) throw new Error('API Error');
                const data = await response.json();
                
                let name = data.name || data.address.city || data.address.town || data.address.village || "Unknown Area";
                if (data.address.state) name += `, ${data.address.state}`;
                return { name, lat: data.lat, lon: data.lon, raw: data };
            } catch (error) {
                throw error;
            }
        }
    }

    // ==========================================================================
    // Module: Core Application Controller
    // ==========================================================================
    class AppController {
        constructor() {
            this.Map = new MapService();
            this.API = new LocationAPI();
            
            this.DOM = {
                searchInput: document.getElementById('search-input'),
                searchDropdown: document.getElementById('search-dropdown'),
                searchResults: document.getElementById('search-results'),
                searchHistory: document.getElementById('search-history'),
                historyList: document.getElementById('history-list'),
                searchLoader: document.getElementById('search-loader'),
                clearBtn: document.getElementById('search-clear'),
                btnGps: document.getElementById('btn-gps'),
                mapLoader: document.getElementById('map-overlay-loader'),
                
                // Status UI
                locName: document.getElementById('data-location'),
                confScore: document.getElementById('data-confidence'),
                reportCount: document.getElementById('data-reports'),
                lastTime: document.getElementById('data-time'),
                updatedBy: document.getElementById('data-user'),
                mainBadge: document.getElementById('badge-main-status'),
                
                // Modal UI
                modal: document.getElementById('modal-report'),
                modalForm: document.getElementById('form-report'),
                btnReport: document.getElementById('btn-report'),
                modalLocName: document.getElementById('modal-loc-name')
            };

            this.state = {
                currentLocation: StorageService.get(CONFIG.storageKeys.lastLocation, null),
                history: StorageService.get(CONFIG.storageKeys.recentSearches, [])
            };

            this.bindEvents();
            if (this.state.currentLocation) this.updateStatusDashboard(this.state.currentLocation.name, this.state.currentLocation.lat, this.state.currentLocation.lon);
        }

        bindEvents() {
            // Search Debounce
            this.DOM.searchInput.addEventListener('input', Utils.debounce((e) => this.handleSearchInput(e), 400));
            
            // Search UI Focus/Blur
            this.DOM.searchInput.addEventListener('focus', () => this.showSearchDropdown());
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.search-module')) this.hideSearchDropdown();
            });

            // Clear Search
            this.DOM.clearBtn.addEventListener('click', () => {
                this.DOM.searchInput.value = '';
                this.DOM.clearBtn.classList.add('hidden');
                this.DOM.searchInput.focus();
                this.showSearchDropdown();
            });

            // History Clear
            document.getElementById('clear-history').addEventListener('click', () => {
                this.state.history = [];
                StorageService.remove(CONFIG.storageKeys.recentSearches);
                this.renderHistory();
            });

            // GPS Detection
            this.DOM.btnGps.addEventListener('click', () => this.detectLocation());

            // Modal Interactions
            this.DOM.btnReport.addEventListener('click', () => this.openModal());
            document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
                btn.addEventListener('click', () => this.DOM.modal.close());
            });
            this.DOM.modalForm.addEventListener('submit', (e) => this.submitReport(e));
        }

        // --- Search Logic ---
        async handleSearchInput(e) {
            const query = e.target.value.trim();
            if (query.length > 0) {
                this.DOM.clearBtn.classList.remove('hidden');
            } else {
                this.DOM.clearBtn.classList.add('hidden');
            }

            if (query.length < 3) {
                this.DOM.searchResults.innerHTML = '';
                this.renderHistory();
                return;
            }

            this.DOM.searchLoader.classList.remove('hidden');
            this.DOM.searchHistory.classList.add('hidden');
            this.DOM.searchInput.setAttribute('aria-expanded', 'true');

            try {
                const results = await this.API.search(query);
                if (results) this.renderSearchResults(results);
            } catch (error) {
                console.error(error);
                Notify.show('Search Error', 'Failed to fetch location suggestions', 'error');
            } finally {
                this.DOM.searchLoader.classList.add('hidden');
            }
        }

        renderSearchResults(results) {
            this.DOM.searchResults.innerHTML = '';
            if (results.length === 0) {
                this.DOM.searchResults.innerHTML = '<div class="search-result-item">No results found.</div>';
                return;
            }

            results.forEach(item => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.setAttribute('role', 'option');
                div.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 
                                 <span>${item.display_name}</span>`;
                
                div.addEventListener('click', () => {
                    const shortName = item.name || item.display_name.split(',')[0];
                    this.selectLocation(shortName, parseFloat(item.lat), parseFloat(item.lon));
                });
                this.DOM.searchResults.appendChild(div);
            });
        }

        showSearchDropdown() {
            this.DOM.searchDropdown.classList.remove('hidden');
            if (this.DOM.searchInput.value.length < 3) {
                this.renderHistory();
            }
        }

        hideSearchDropdown() {
            this.DOM.searchDropdown.classList.add('hidden');
            this.DOM.searchInput.setAttribute('aria-expanded', 'false');
        }

        renderHistory() {
            this.DOM.searchResults.innerHTML = '';
            if (this.state.history.length > 0) {
                this.DOM.searchHistory.classList.remove('hidden');
                this.DOM.historyList.innerHTML = '';
                this.state.history.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'history-item';
                    li.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> 
                                    <span>${item.name}</span>`;
                    li.addEventListener('click', () => this.selectLocation(item.name, item.lat, item.lon, false));
                    this.DOM.historyList.appendChild(li);
                });
            } else {
                this.DOM.searchHistory.classList.add('hidden');
            }
        }

        addToHistory(name, lat, lon) {
            const newItem = { name, lat, lon };
            // Remove duplicate if exists
            this.state.history = this.state.history.filter(i => i.name !== name);
            this.state.history.unshift(newItem);
            if (this.state.history.length > 5) this.state.history.pop();
            StorageService.set(CONFIG.storageKeys.recentSearches, this.state.history);
        }

        // --- Core Location Selection ---
        selectLocation(name, lat, lon, updateHistory = true) {
            this.DOM.searchInput.value = name;
            this.hideSearchDropdown();
            if (updateHistory) this.addToHistory(name, lat, lon);
            
            // Save state
            this.state.currentLocation = { name, lat, lon };
            StorageService.set(CONFIG.storageKeys.lastLocation, this.state.currentLocation);

            // Update UI
            this.Map.setMarker(lat, lon, name);
            this.updateStatusDashboard(name, lat, lon);
            Notify.show('Location Selected', `Fetching data for ${name}`, 'success');
        }

        // --- GPS ---
        detectLocation() {
            if (!('geolocation' in navigator)) {
                Notify.show('Error', 'Geolocation is not supported by your browser', 'error');
                return;
            }

            this.DOM.mapLoader.classList.remove('hidden');
            
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    try {
                        const geoData = await this.API.reverseGeocode(latitude, longitude);
                        this.DOM.mapLoader.classList.add('hidden');
                        this.selectLocation(geoData.name, geoData.lat, geoData.lon);
                    } catch (error) {
                        this.DOM.mapLoader.classList.add('hidden');
                        Notify.show('API Error', 'Could not resolve location name', 'error');
                        // Fallback with coordinates
                        this.selectLocation("Current Location", latitude, longitude);
                    }
                },
                (error) => {
                    this.DOM.mapLoader.classList.add('hidden');
                    let msg = 'Failed to get location.';
                    if (error.code === 1) msg = 'Location permission denied.';
                    Notify.show('GPS Error', msg, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }

        // --- Status Dashboard ---
        setDashboardLoading(isLoading) {
            const els = [this.DOM.locName, this.DOM.confScore, this.DOM.reportCount, this.DOM.lastTime, this.DOM.updatedBy];
            if (isLoading) {
                els.forEach(el => el.classList.add('skeleton-text'));
                this.DOM.mainBadge.className = 'status-badge badge-neutral skeleton-text';
                this.DOM.mainBadge.textContent = 'Loading';
            } else {
                els.forEach(el => el.classList.remove('skeleton-text'));
                this.DOM.mainBadge.classList.remove('skeleton-text');
            }
        }

        updateStatusDashboard(name, lat, lon) {
            this.setDashboardLoading(true);
            
            // Simulate API Network Delay for realism
            setTimeout(() => {
                this.setDashboardLoading(false);
                
                const statusData = Utils.generateMockStatus(lat, lon);
                
                this.DOM.locName.textContent = name;
                this.DOM.confScore.textContent = statusData.conf;
                this.DOM.reportCount.textContent = statusData.count;
                this.DOM.lastTime.textContent = statusData.time;
                this.DOM.updatedBy.textContent = statusData.user;
                this.DOM.modalLocName.textContent = name;

                // Configure Badge
                switch(statusData.type) {
                    case 'available':
                        this.DOM.mainBadge.className = 'status-badge badge-green';
                        this.DOM.mainBadge.textContent = 'Available'; break;
                    case 'outage':
                        this.DOM.mainBadge.className = 'status-badge badge-red';
                        this.DOM.mainBadge.textContent = 'Power Outage'; break;
                    case 'voltage':
                        this.DOM.mainBadge.className = 'status-badge badge-orange';
                        this.DOM.mainBadge.textContent = 'Voltage Issue'; break;
                    case 'maintenance':
                        this.DOM.mainBadge.className = 'status-badge badge-blue';
                        this.DOM.mainBadge.textContent = 'Maintenance'; break;
                    default:
                        this.DOM.mainBadge.className = 'status-badge badge-neutral';
                        this.DOM.mainBadge.textContent = 'No Data';
                }
            }, 800);
        }

        // --- Community Update Modal ---
        openModal() {
            if (!this.state.currentLocation) {
                Notify.show('Action Required', 'Please select a location first', 'warning');
                this.DOM.searchInput.focus();
                return;
            }
            this.DOM.modalForm.reset();
            this.DOM.modal.showModal(); // Native Dialog API
        }

        submitReport(e) {
            e.preventDefault();
            const formData = new FormData(this.DOM.modalForm);
            const status = formData.get('power_status');
            
            if (!status) return;

            // Mock saving to local storage for persistence demonstration
            const reports = StorageService.get(CONFIG.storageKeys.userReports, []);
            reports.push({
                loc: this.state.currentLocation,
                status: status,
                timestamp: new Date().toISOString()
            });
            StorageService.set(CONFIG.storageKeys.userReports, reports);

            this.DOM.modal.close();
            Notify.show('Report Submitted', 'Thank you for contributing to the community!', 'success');
            
            // Re-trigger update to reflect new state
            this.updateStatusDashboard(this.state.currentLocation.name, this.state.currentLocation.lat, this.state.currentLocation.lon);
        }
    }

    // Initialize Application when DOM is ready
    return {
        init: () => {
            console.log("Initializing BijliMap Phase 4 Architecture...");
            new AppController();
        }
    };

})();

document.addEventListener('DOMContentLoaded', () => BijliMapApp.init());
