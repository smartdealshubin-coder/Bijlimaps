// script.js
/**
 * BijliMap - Phase 5 Working MVP
 * Architecture: ES Modules, Firebase Integration, Mobile-First
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const BijliMapApp = (function() {
    'use strict';

    // ==========================================================================
    // Core Configuration
    // ==========================================================================
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
        api: {
            nominatimUrl: 'https://nominatim.openstreetmap.org',
            countryCodes: 'in', // Restrict to India
            userAgent: 'BijliMap_Phase5_MVP'
        },
        storageKeys: {
            recentSearches: 'bijlimap_recent_searches',
            lastLocation: 'bijlimap_last_location'
        },
        map: { defaultCenter: [20.5937, 78.9629], defaultZoom: 5, detailZoom: 14 }
    };

    // Initialize Firebase
    const app = initializeApp(CONFIG.firebase);
    const db = getFirestore(app);

    // ==========================================================================
    // Services
    // ==========================================================================
    class StorageService {
        static get(key, defaultValue = null) {
            try { return JSON.parse(localStorage.getItem(key)) || defaultValue; } 
            catch { return defaultValue; }
        }
        static set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
        static remove(key) { localStorage.removeItem(key); }
    }

    class NotificationService {
        constructor() { this.container = document.getElementById('toast-container'); }
        show(title, message, type = 'info', duration = 4000) {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `<div class="toast-title">${this.escapeHTML(title)}</div><div class="toast-msg">${this.escapeHTML(message)}</div>`;
            this.container.appendChild(toast);
            setTimeout(() => { toast.remove(); }, duration);
        }
        escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
    }
    const Notify = new NotificationService();

    const Utils = {
        debounce(func, wait) {
            let timeout;
            return function(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func(...args), wait);
            };
        },
        timeAgo(dateString) {
            if (!dateString) return "N/A";
            const date = new Date(dateString);
            const seconds = Math.floor((new Date() - date) / 1000);
            if (seconds < 60) return "Just now";
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
            const days = Math.floor(hours / 24);
            if (days === 1) return "Yesterday";
            if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
            return date.toLocaleDateString();
        }
    };

    // ==========================================================================
    // Database Service (Firebase)
    // ==========================================================================
    class DatabaseService {
        static async saveReport(locationName, lat, lon, status, reporterName) {
            try {
                const docRef = await addDoc(collection(db, "reports"), {
                    locationName: locationName,
                    lat: lat,
                    lon: lon,
                    status: status,
                    reporterName: reporterName,
                    timestamp: new Date().toISOString()
                });
                return docRef.id;
            } catch (e) {
                console.error("Error adding document: ", e);
                throw e;
            }
        }

        static async getLocationStatus(locationName) {
            try {
                // For MVP, querying by exact location string match. 
                // Fetching all for the location and sorting client-side avoids needing manual Firestore indexes out of the box.
                const q = query(collection(db, "reports"), where("locationName", "==", locationName));
                const querySnapshot = await getDocs(q);
                
                let reports = [];
                querySnapshot.forEach((doc) => { reports.push(doc.data()); });
                
                if (reports.length === 0) return null;
                
                // Sort by timestamp descending
                reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                return {
                    totalReports: reports.length,
                    latestStatus: reports[0].status,
                    latestReporter: reports[0].reporterName,
                    latestTimestamp: reports[0].timestamp
                };
            } catch (e) {
                console.error("Error getting documents: ", e);
                return null;
            }
        }
    }

    // ==========================================================================
    // Map & Location Services
    // ==========================================================================
    class MapService {
        constructor() {
            this.map = null;
            this.currentMarker = null;
            this.init();
        }
        init() {
            const savedLoc = StorageService.get(CONFIG.storageKeys.lastLocation);
            const startCenter = savedLoc ? [savedLoc.lat, savedLoc.lon] : CONFIG.map.defaultCenter;
            const startZoom = savedLoc ? CONFIG.map.detailZoom : CONFIG.map.defaultZoom;

            this.map = L.map('map-view', { zoomControl: false }).setView(startCenter, startZoom);
            L.control.zoom({ position: window.innerWidth > 900 ? 'bottomright' : 'topright' }).addTo(this.map);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM', maxZoom: 19 }).addTo(this.map);
            
            if (savedLoc) this.setMarker(savedLoc.lat, savedLoc.lon, savedLoc.name);
        }
        setMarker(lat, lon, popupText) {
            if (this.currentMarker) this.map.removeLayer(this.currentMarker);
            const customIcon = L.divIcon({ className: 'custom-pulse-marker', html: '<div class="pulse-ring"></div><div class="pulse-core"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
            this.currentMarker = L.marker([lat, lon], { icon: customIcon }).addTo(this.map);
            if (popupText) this.currentMarker.bindPopup(`<b>${popupText}</b>`).openPopup();
            this.map.flyTo([lat, lon], CONFIG.map.detailZoom, { animate: true, duration: 1.2 });
        }
    }

    class LocationAPI {
        constructor() { this.abortController = null; }
        async search(query) {
            if (this.abortController) this.abortController.abort();
            this.abortController = new AbortController();
            try {
                const res = await fetch(`${CONFIG.api.nominatimUrl}/search?format=json&q=${encodeURIComponent(query)}&countrycodes=${CONFIG.api.countryCodes}&limit=5`, { signal: this.abortController.signal });
                return res.ok ? await res.json() : [];
            } catch (e) { return e.name === 'AbortError' ? null : []; }
        }
        async reverseGeocode(lat, lon) {
            const res = await fetch(`${CONFIG.api.nominatimUrl}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`);
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();
            let name = data.name || data.address.city || data.address.town || data.address.village || "Unknown Area";
            if (data.address.state) name += `, ${data.address.state}`;
            return { name, lat: data.lat, lon: data.lon };
        }
    }

    // ==========================================================================
    // App Controller
    // ==========================================================================
    class AppController {
        constructor() {
            this.Map = new MapService();
            this.API = new LocationAPI();
            this.state = {
                currentLocation: StorageService.get(CONFIG.storageKeys.lastLocation, null),
                history: StorageService.get(CONFIG.storageKeys.recentSearches, [])
            };
            this.cacheDOM();
            this.bindEvents();
            if (this.state.currentLocation) this.loadLocationData(this.state.currentLocation.name, this.state.currentLocation.lat, this.state.currentLocation.lon);
        }

        cacheDOM() {
            this.DOM = {
                searchInput: document.getElementById('search-input'),
                searchDropdown: document.getElementById('search-dropdown'),
                searchResults: document.getElementById('search-results'),
                searchLoader: document.getElementById('search-loader'),
                btnGps: document.getElementById('btn-gps'),
                
                // Status UI
                locName: document.getElementById('data-location'),
                lastTime: document.getElementById('data-time'),
                updatedBy: document.getElementById('data-user'),
                reportCount: document.getElementById('data-reports'),
                mainBadge: document.getElementById('badge-main-status'),
                
                // Modal
                modal: document.getElementById('modal-report'),
                modalForm: document.getElementById('form-report'),
                btnReport: document.getElementById('btn-report'),
                modalLocName: document.getElementById('modal-loc-name'),
                btnSubmitReport: document.getElementById('btn-submit-report'),
                
                // Navigation
                navBtns: document.querySelectorAll('[data-target]'),
                views: document.querySelectorAll('.view-section'),
                mobileMenuBtn: document.getElementById('mobile-menu-btn'),
                headerNav: document.getElementById('header-nav')
            };
        }

        bindEvents() {
            // Navigation
            this.DOM.navBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.switchView(btn.getAttribute('data-target'));
                    this.DOM.headerNav.classList.remove('open');
                });
            });
            this.DOM.mobileMenuBtn.addEventListener('click', () => this.DOM.headerNav.classList.toggle('open'));

            // Search
            this.DOM.searchInput.addEventListener('input', Utils.debounce((e) => this.handleSearch(e.target.value), 400));
            document.addEventListener('click', (e) => { if (!e.target.closest('.search-module')) this.DOM.searchDropdown.classList.add('hidden'); });

            // GPS
            this.DOM.btnGps.addEventListener('click', () => this.detectLocation());

            // Reporting
            this.DOM.btnReport.addEventListener('click', () => this.openReportModal());
            document.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.addEventListener('click', () => this.DOM.modal.close()));
            this.DOM.modalForm.addEventListener('submit', (e) => this.submitReport(e));
        }

        switchView(targetId) {
            this.DOM.views.forEach(view => view.classList.remove('active'));
            document.getElementById(`view-${targetId}`).classList.add('active');
            
            // Fix map sizing issue when switching back to dashboard
            if (targetId === 'dashboard' && this.Map.map) {
                setTimeout(() => this.Map.map.invalidateSize(), 100);
            }
        }

        async handleSearch(query) {
            if (query.length < 3) return this.DOM.searchDropdown.classList.add('hidden');
            this.DOM.searchLoader.classList.remove('hidden');
            this.DOM.searchDropdown.classList.remove('hidden');
            
            const results = await this.API.search(query);
            this.DOM.searchResults.innerHTML = '';
            
            if (results && results.length > 0) {
                results.forEach(item => {
                    const div = document.createElement('div');
                    div.className = 'search-result-item';
                    div.innerHTML = `<span>${item.display_name}</span>`;
                    div.addEventListener('click', () => {
                        this.DOM.searchDropdown.classList.add('hidden');
                        this.DOM.searchInput.value = '';
                        this.selectLocation(item.name || item.display_name.split(',')[0], parseFloat(item.lat), parseFloat(item.lon));
                    });
                    this.DOM.searchResults.appendChild(div);
                });
            } else {
                this.DOM.searchResults.innerHTML = '<div class="search-result-item">No locations found.</div>';
            }
            this.DOM.searchLoader.classList.add('hidden');
        }

        detectLocation() {
            if (!('geolocation' in navigator)) return Notify.show('Error', 'GPS not supported', 'error');
            Notify.show('Locating', 'Finding your location...', 'info');
            
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    try {
                        const data = await this.API.reverseGeocode(pos.coords.latitude, pos.coords.longitude);
                        this.selectLocation(data.name, data.lat, data.lon);
                    } catch (e) { Notify.show('Error', 'Could not resolve address', 'error'); }
                },
                () => Notify.show('Error', 'GPS permission denied', 'error'),
                { enableHighAccuracy: true }
            );
        }

        selectLocation(name, lat, lon) {
            this.state.currentLocation = { name, lat, lon };
            StorageService.set(CONFIG.storageKeys.lastLocation, this.state.currentLocation);
            this.Map.setMarker(lat, lon, name);
            this.loadLocationData(name, lat, lon);
        }

        async loadLocationData(name, lat, lon) {
            this.setLoading(true);
            this.DOM.locName.textContent = name;
            this.DOM.modalLocName.textContent = name;

            const data = await DatabaseService.getLocationStatus(name);
            
            this.setLoading(false);
            
            if (data) {
                this.DOM.lastTime.textContent = Utils.timeAgo(data.latestTimestamp);
                this.DOM.updatedBy.textContent = `Updated by ${data.latestReporter}`;
                this.DOM.reportCount.textContent = `${data.totalReports} Verified`;
                this.updateBadge(data.latestStatus);
            } else {
                this.DOM.lastTime.textContent = "Never";
                this.DOM.updatedBy.textContent = "No reports yet";
                this.DOM.reportCount.textContent = "0";
                this.updateBadge("Unknown");
            }
        }

        setLoading(isLoading) {
            const els = [this.DOM.lastTime, this.DOM.updatedBy, this.DOM.reportCount];
            if (isLoading) {
                els.forEach(el => el.classList.add('skeleton-text'));
                this.DOM.mainBadge.className = 'status-badge badge-neutral skeleton-text';
                this.DOM.mainBadge.textContent = 'Loading';
            } else {
                els.forEach(el => el.classList.remove('skeleton-text'));
            }
        }

        updateBadge(status) {
            this.DOM.mainBadge.textContent = status;
            this.DOM.mainBadge.className = 'status-badge';
            if (status === 'Available') this.DOM.mainBadge.classList.add('badge-green');
            else if (status === 'Power Outage') this.DOM.mainBadge.classList.add('badge-red');
            else if (status === 'Voltage Issue') this.DOM.mainBadge.classList.add('badge-orange');
            else if (status === 'Maintenance') this.DOM.mainBadge.classList.add('badge-blue');
            else this.DOM.mainBadge.classList.add('badge-neutral');
        }

        openReportModal() {
            if (!this.state.currentLocation) return Notify.show('Required', 'Search a location first', 'error');
            this.DOM.modalForm.reset();
            this.DOM.modal.showModal();
        }

        async submitReport(e) {
            e.preventDefault();
            const btn = this.DOM.btnSubmitReport;
            btn.disabled = true;
            btn.textContent = "Saving...";

            const formData = new FormData(this.DOM.modalForm);
            const status = formData.get('power_status');
            const reporter = formData.get('reporter_name');
            const loc = this.state.currentLocation;

            try {
                await DatabaseService.saveReport(loc.name, loc.lat, loc.lon, status, reporter);
                this.DOM.modal.close();
                Notify.show('Success', 'Report saved to database!', 'success');
                this.loadLocationData(loc.name, loc.lat, loc.lon);
            } catch (error) {
                Notify.show('Error', 'Could not save report', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = "Submit Real Update";
            }
        }
    }

    return { init: () => new AppController() };
})();

document.addEventListener('DOMContentLoaded', BijliMapApp.init);
