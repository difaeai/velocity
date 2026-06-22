document.addEventListener('DOMContentLoaded', () => {

    // ═══════════════════════════════════════
    //  CLOCK
    // ═══════════════════════════════════════
    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        document.getElementById('current-time').textContent = timeStr;
        const opsTime = document.getElementById('ops-time');
        if (opsTime) opsTime.textContent = timeStr;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ═══════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════
    let driverVerified = false;
    let driverOnline = false;
    let userGender = 'male';
    let currentSeats = 3;
    let walkTimeSeconds = 270;
    let activeTrip = null;
    let totalRevenue = 0;
    let totalCommissions = 0;
    let totalDriverPayout = 0;
    let activePools = 0;
    let isDeviating = false;
    let totalTrips = 0;
    let totalDriverEarnings = 0;
    let sosCount = 0;
    let devCount = 0;
    let driverOnlineSeconds = 0;
    let driverOnlineInterval = null;

    // ═══════════════════════════════════════
    //  DRIVER PROFILES
    // ═══════════════════════════════════════
    const fakeDrivers = [
        {
            name: "Sayeed Husein",
            vehicle: "White Corolla",
            plate: "ASD-392",
            rating: "4.8",
            rides: "1.2k",
            img: "https://lh3.googleusercontent.com/aida-public/AB6AXuD_xlulEH4rIQw3zq9CncJWYUZmt2iAD5zOlBJL4wxVB-VmQPqXZf8bZhPkHeHPxLKJkhFWbzzaoM4OuGfyER8ij25rkr2unAiAeUkV75jeo37vOxMCXUEURX9njnwkCx8jldbeLZ9jXEjNCY7kRyR6i-XOcTEs96iCESUpE00DXGEc3ke6npuxKhRLCKquvqaYpFawproG8G5f-FF3mlwL1zCIf4DmCjf8A-oX2ruQaaOdfUFSmGt3cM2FhoPWe4aCtVojFrhBSfU"
        },
        {
            name: "Imran Qureshi",
            vehicle: "Suzuki Alto",
            plate: "ICT-940",
            rating: "4.7",
            rides: "980",
            img: "https://lh3.googleusercontent.com/aida-public/AB6AXuByqS8WOGSknJmGr8ZEN9xu4pg6eaG4YGSpcjSXhP5a-br5HP7l2vWqC4wlAb2JqLYnoxM3NEdg_7sJBqNTYraOhBDPVQA6YaI__cOBH3FBW5umxvwh4iUKc9IRrpG29hG2-4yTclBaiwSO1kReyRxNb_dz47LFEODGhmQ9eSpVp3E-Zxi3ZhyuDhCL4APPYvg_rSW_oFgcjSMWwmiEGejA8yCCdpT0BQyumenEUN-r-AOaAHmyDRoN7l4tFXFh2C8JQtRNxJlRhCg"
        }
    ];

    const actualDriver = {
        name: "Ahmed Khan",
        vehicle: "Toyota Corolla (AC)",
        plate: "LEC-4820",
        rating: "4.9",
        rides: "2.5k",
        img: "https://lh3.googleusercontent.com/aida-public/AB6AXuByqS8WOGSknJmGr8ZEN9xu4pg6eaG4YGSpcjSXhP5a-br5HP7l2vWqC4wlAb2JqLYnoxM3NEdg_7sJBqNTYraOhBDPVQA6YaI__cOBH3FBW5umxvwh4iUKc9IRrpG29hG2-4yTclBaiwSO1kReyRxNb_dz47LFEODGhmQ9eSpVp3E-Zxi3ZhyuDhCL4APPYvg_rSW_oFgcjSMWwmiEGejA8yCCdpT0BQyumenEUN-r-AOaAHmyDRoN7l4tFXFh2C8JQtRNxJlRhCg"
    };

    // ═══════════════════════════════════════
    //  DOM REFS
    // ═══════════════════════════════════════
    const tabPlayground = document.getElementById('tab-playground');
    const tabAdmin = document.getElementById('tab-admin');
    const tabOps = document.getElementById('tab-ops');
    const viewPlayground = document.getElementById('view-playground');
    const viewAdmin = document.getElementById('view-admin');
    const viewOps = document.getElementById('view-ops');

    // Passenger screens
    const allPassengerScreens = ['p-screen-home','p-screen-bid-entry','p-screen-bid-loading',
        'p-screen-nav','p-screen-tracking','p-screen-invoice',
        'p-screen-wallet','p-screen-history','p-screen-profile'];
    
    // Driver screens
    const allDriverScreens = ['d-screen-register','d-screen-home','d-screen-bid-request',
        'd-screen-nav','d-screen-ledger'];

    const terminalLog = document.getElementById('terminal-log');
    const btnClearTerminal = document.getElementById('btn-clear-terminal');
    const pCtrlMale = document.getElementById('p-ctrl-male');
    const pCtrlFemale = document.getElementById('p-ctrl-female');
    const seatsCtrlSlider = document.getElementById('seats-ctrl-slider');
    const seatsCtrlVal = document.getElementById('seats-ctrl-val');
    const fareShare = document.getElementById('fare-share');
    const ctrlBtnSos = document.getElementById('ctrl-btn-sos');
    const ctrlBtnDeviation = document.getElementById('ctrl-btn-deviation');
    const ctrlBtnComplete = document.getElementById('ctrl-btn-complete-trip');

    // Admin
    const adminActivePools = document.getElementById('admin-active-pools');
    const adminRevenue = document.getElementById('admin-revenue');
    const adminCommissions = document.getElementById('admin-commissions');
    const adminPendingBadge = document.getElementById('admin-pending-badge');
    const adminBtnApproveAhmed = document.getElementById('admin-btn-approve-ahmed');
    const adminRowAhmed = document.getElementById('admin-row-ahmed');
    const adminSafetyDesk = document.getElementById('admin-safety-desk');
    const adminApprovedDrivers = document.getElementById('admin-approved-drivers');

    // Interval handles
    let pWalkTimerInterval = null;
    let carTrackingInterval = null;
    let bidTimeout1 = null;
    let bidTimeout2 = null;
    let selectedRideType = 'bike';

    // Fare map
    const baseFares = { bike: 150, auto: 250, mini: 400, ac: 550, comfort: 750, xl: 1100 };

    // ═══════════════════════════════════════
    //  TERMINAL LOG
    // ═══════════════════════════════════════
    function logTerminal(message, type = 'info') {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const entry = document.createElement('div');
        entry.className = "terminal-log-entry";
        const colors = {
            error: 'text-red-400 font-bold',
            warning: 'text-amber-400 font-bold',
            success: 'text-emerald-400 font-bold',
            info: 'text-emerald-500'
        };
        const prefix = { error: '[SOS]', warning: '[WARN]', success: '[OK]', info: '[LOG]' };
        entry.innerHTML = `<span class="${colors[type]}">[${time}] ${prefix[type]} ${message}</span>`;
        terminalLog.appendChild(entry);
        terminalLog.scrollTop = terminalLog.scrollHeight;
    }

    btnClearTerminal.addEventListener('click', () => { terminalLog.innerHTML = ''; });

    // ═══════════════════════════════════════
    //  TAB SWITCHER
    // ═══════════════════════════════════════
    function activateTab(activeBtn, activeView) {
        [tabPlayground, tabAdmin, tabOps].forEach(btn => {
            btn.className = "px-4 py-2 text-xs font-semibold rounded-lg text-gray-500 hover:text-gray-800 flex items-center gap-1.5 transition-all";
        });
        [viewPlayground, viewAdmin, viewOps].forEach(v => v.classList.add('hidden'));
        activeBtn.className = "px-4 py-2 text-xs font-bold rounded-lg bg-white text-[#004c31] shadow-sm flex items-center gap-1.5 transition-all";
        activeView.classList.remove('hidden');
    }

    tabPlayground.addEventListener('click', () => activateTab(tabPlayground, viewPlayground));
    tabAdmin.addEventListener('click', () => activateTab(tabAdmin, viewAdmin));
    tabOps.addEventListener('click', () => activateTab(tabOps, viewOps));

    // ═══════════════════════════════════════
    //  ADMIN SIDEBAR PANEL SWITCHER
    // ═══════════════════════════════════════
    document.querySelectorAll('.admin-nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const panelId = this.dataset.panel;
            document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('hidden'));
            const panel = document.getElementById(panelId);
            if (panel) panel.classList.remove('hidden');
        });
    });

    // ═══════════════════════════════════════
    //  SCREEN SWITCHERS
    // ═══════════════════════════════════════
    function showPassengerScreen(screenId) {
        allPassengerScreens.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        const target = document.getElementById(screenId);
        if (target) target.classList.remove('hidden');

        const phoneNav = document.getElementById('phone-nav');
        const homeScreens = ['p-screen-home','p-screen-wallet','p-screen-history','p-screen-profile'];
        if (homeScreens.includes(screenId)) {
            phoneNav.classList.remove('hidden');
        } else {
            phoneNav.classList.add('hidden');
        }

        if (screenId === 'p-screen-nav') startPassengerWalkTimer();
        else stopPassengerWalkTimer();
    }

    function showDriverScreen(screenId) {
        allDriverScreens.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
        const target = document.getElementById(screenId);
        if (target) target.classList.remove('hidden');

        if (screenId === 'd-screen-nav') startDriverCarTrackingAnimation();
        else stopDriverCarTrackingAnimation();
    }

    // ═══════════════════════════════════════
    //  PASSENGER BOTTOM NAV
    // ═══════════════════════════════════════
    const pNavScreenMap = {
        'pnav-home': 'p-screen-home',
        'pnav-history': 'p-screen-history',
        'pnav-wallet': 'p-screen-wallet',
        'pnav-profile': 'p-screen-profile'
    };

    Object.entries(pNavScreenMap).forEach(([btnId, screenId]) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                showPassengerScreen(screenId);
                // Update active state
                document.querySelectorAll('.pnav-btn').forEach(b => {
                    b.className = "pnav-btn flex flex-col items-center justify-center text-on-surface-variant p-2 gap-0.5";
                });
                btn.className = "pnav-btn flex flex-col items-center justify-center bg-primary/10 text-primary rounded-full px-3 py-0.5 gap-0.5";
            });
        }
    });

    // Back buttons returning to home
    document.querySelectorAll('.p-nav-home-btn').forEach(btn => {
        btn.addEventListener('click', () => showPassengerScreen('p-screen-home'));
    });

    // ═══════════════════════════════════════
    //  ADMIN: DRIVER APPROVAL
    // ═══════════════════════════════════════
    adminBtnApproveAhmed.addEventListener('click', () => {
        driverVerified = true;
        adminRowAhmed.cells[4].innerHTML = '<span class="badge-success">Approved</span>';
        adminRowAhmed.cells[5].innerHTML = '<button class="px-3 py-1.5 bg-gray-100 text-gray-500 rounded-lg font-bold text-[10px]">Suspend</button>';
        adminBtnApproveAhmed.disabled = true;
        adminPendingBadge.textContent = "0 PENDING";
        adminPendingBadge.className = "px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold text-xs";
        if (adminApprovedDrivers) adminApprovedDrivers.textContent = "1";
        logTerminal("Super Admin approved driver Ahmed Khan. Account unlocked.", "success");
        showDriverScreen('d-screen-home');
    });

    // ═══════════════════════════════════════
    //  DRIVER: ONLINE TOGGLE
    // ═══════════════════════════════════════
    const dBtnOnlineToggle = document.getElementById('d-btn-online-toggle');
    const dStatusLabel = document.getElementById('d-status-label');
    const dMapOfflineOverlay = document.getElementById('d-map-offline-overlay');
    const dMapOnlineOverlay = document.getElementById('d-map-online-overlay');

    dBtnOnlineToggle.addEventListener('click', () => {
        if (!driverVerified) {
            logTerminal("Driver must be approved by Admin first.", "warning");
            return;
        }
        driverOnline = !driverOnline;

        if (driverOnline) {
            dBtnOnlineToggle.classList.add('active');
            dStatusLabel.textContent = "ONLINE";
            dStatusLabel.className = "text-[10px] font-black text-emerald-600";
            dMapOfflineOverlay.classList.add('hidden');
            dMapOnlineOverlay.classList.remove('hidden');
            driverOnlineInterval = setInterval(() => {
                driverOnlineSeconds++;
                const h = Math.floor(driverOnlineSeconds / 3600);
                const m = Math.floor((driverOnlineSeconds % 3600) / 60);
                const el = document.getElementById('d-online-time');
                if (el) el.textContent = `${h}h ${m}m`;
                const opsEl = document.getElementById('ops-drivers-online');
                if (opsEl) opsEl.textContent = "1";
                const mapEl = document.getElementById('ops-active-drivers-map');
                if (mapEl) mapEl.textContent = "1";
            }, 1000);
            logTerminal("Driver Ahmed Khan is now ONLINE. Waiting for passenger bids.");
        } else {
            dBtnOnlineToggle.classList.remove('active');
            dStatusLabel.textContent = "OFFLINE";
            dStatusLabel.className = "text-[10px] font-black text-gray-400";
            dMapOfflineOverlay.classList.remove('hidden');
            dMapOnlineOverlay.classList.add('hidden');
            if (driverOnlineInterval) clearInterval(driverOnlineInterval);
            const opsEl = document.getElementById('ops-drivers-online');
            if (opsEl) opsEl.textContent = "0";
            logTerminal("Driver Ahmed Khan is now OFFLINE.");
        }
    });

    // ═══════════════════════════════════════
    //  PASSENGER: BOOKING FLOW
    // ═══════════════════════════════════════
    document.getElementById('p-btn-book-shared').addEventListener('click', () => {
        showPassengerScreen('p-screen-bid-entry');
    });

    document.getElementById('p-home-search').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) showPassengerScreen('p-screen-bid-entry');
    });

    document.querySelectorAll('.p-quick-address').forEach(btn => {
        btn.addEventListener('click', () => showPassengerScreen('p-screen-bid-entry'));
    });

    document.querySelectorAll('.p-back-btn').forEach(btn => {
        btn.addEventListener('click', () => showPassengerScreen('p-screen-home'));
    });

    // Pool toggle
    const pPoolToggle = document.getElementById('p-pool-toggle');
    if (pPoolToggle) {
        pPoolToggle.addEventListener('click', function() {
            this.classList.toggle('active');
            const isPool = this.classList.contains('active');
            logTerminal(`Smart Pool ${isPool ? 'enabled' : 'disabled'} by passenger.`);
        });
    }

    // ═══════════════════════════════════════
    //  RIDE TYPE CARD SELECTION
    // ═══════════════════════════════════════
    const pBidInput = document.getElementById('p-bid-input');
    const pRecFareLabel = document.getElementById('p-rec-fare-label');

    document.querySelectorAll('.ride-type-card').forEach(card => {
        card.addEventListener('click', function() {
            document.querySelectorAll('.ride-type-card').forEach(c => {
                c.classList.remove('border-primary','bg-emerald-50/50','border-2');
                c.classList.add('border','border-gray-200');
            });
            this.classList.remove('border','border-gray-200');
            this.classList.add('border-2','border-primary','bg-emerald-50/50');
            selectedRideType = this.dataset.type;
            const recFare = parseInt(this.dataset.fare) || baseFares[selectedRideType] || 150;
            pBidInput.value = recFare;
            if (pRecFareLabel) pRecFareLabel.textContent = `${recFare} PKR`;
            updateFareShareDisplay(recFare);
        });
    });

    document.getElementById('p-bid-plus').addEventListener('click', () => {
        pBidInput.value = parseInt(pBidInput.value) + 50;
        updateFareShareDisplay(parseInt(pBidInput.value));
    });
    document.getElementById('p-bid-minus').addEventListener('click', () => {
        const val = parseInt(pBidInput.value);
        if (val > 50) pBidInput.value = val - 50;
        updateFareShareDisplay(parseInt(pBidInput.value));
    });

    function updateFareShareDisplay(fare) {
        if (fareShare) fareShare.textContent = `${Math.round(fare / currentSeats)} PKR`;
    }

    // ═══════════════════════════════════════
    //  BID MATCHING
    // ═══════════════════════════════════════
    const pBtnFindDriver = document.getElementById('p-btn-find-driver');
    const pBidsQueueContainer = document.getElementById('p-bids-queue-container');
    const pOfferedFareLabel = document.getElementById('p-offered-fare-label');
    const dOfferedFare = document.getElementById('d-offered-fare');
    const dPayoutLabel = document.getElementById('d-payout-label');
    const dRequestType = document.getElementById('d-request-type');
    const dBtnCounter50 = document.getElementById('d-btn-counter-50');
    const dBtnCounter100 = document.getElementById('d-btn-counter-100');

    pBtnFindDriver.addEventListener('click', () => {
        const offer = parseInt(pBidInput.value);
        activeTrip = {
            rideType: selectedRideType,
            offeredFare: offer,
            selectedFare: offer,
            passengerGender: userGender,
            seatsOccupied: currentSeats,
            stage: 'bidding'
        };

        pOfferedFareLabel.textContent = `${offer} PKR`;
        showPassengerScreen('p-screen-bid-loading');
        pBidsQueueContainer.innerHTML = '';
        logTerminal(`Passenger requesting ${selectedRideType.toUpperCase()} ride. Offered fare: ${offer} PKR. AI Matching started.`);

        if (driverOnline) {
            dOfferedFare.textContent = `${offer} PKR`;
            if (dPayoutLabel) dPayoutLabel.textContent = `${Math.round(offer * 0.9)} PKR`;
            dRequestType.textContent = selectedRideType.toUpperCase();
            dBtnCounter50.textContent = `+50 → ${offer + 50} PKR`;
            dBtnCounter100.textContent = `+100 → ${offer + 100} PKR`;
            showDriverScreen('d-screen-bid-request');
            logTerminal("Real driver Ahmed Khan notified of incoming bid.");
        }

        // Simulate external bids
        bidTimeout1 = setTimeout(() => {
            addDriverBidCard(fakeDrivers[0], Math.round(offer * 1.1));
        }, 2200);
        bidTimeout2 = setTimeout(() => {
            addDriverBidCard(fakeDrivers[1], offer);
        }, 4500);
    });

    document.getElementById('p-btn-cancel-request').addEventListener('click', () => {
        clearTimeout(bidTimeout1);
        clearTimeout(bidTimeout2);
        activeTrip = null;
        showPassengerScreen('p-screen-bid-entry');
        if (driverOnline) showDriverScreen('d-screen-home');
        logTerminal("Passenger cancelled ride matching request.");
    });

    function addDriverBidCard(driver, fare) {
        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl p-4 border border-gray-200 shadow-md flex items-center justify-between gap-3 slide-up";
        card.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="relative">
                    <img class="w-10 h-10 rounded-full object-cover border border-gray-200" src="${driver.img}" alt="${driver.name}">
                    <span class="absolute -bottom-0.5 -right-0.5 bg-secondary text-white w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold border border-white">✓</span>
                </div>
                <div>
                    <h4 class="font-black text-xs text-gray-800">${driver.name}</h4>
                    <p class="text-[9px] text-gray-400">${driver.vehicle} · ${driver.rating}★ · ${driver.rides} rides</p>
                </div>
            </div>
            <div class="text-right flex flex-col gap-1 items-end shrink-0">
                <span class="font-black text-base text-primary block">${fare} PKR</span>
                <div class="flex gap-1.5">
                    <button class="btn-decline-bid px-2 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold">Decline</button>
                    <button class="btn-accept-bid px-3 py-1 bg-primary text-white rounded-lg text-[9px] font-bold">Accept</button>
                </div>
            </div>
        `;
        card.querySelector('.btn-accept-bid').addEventListener('click', () => hireDriver(driver, fare));
        card.querySelector('.btn-decline-bid').addEventListener('click', () => {
            card.remove();
            logTerminal(`Bid declined from ${driver.name}.`);
        });
        pBidsQueueContainer.appendChild(card);
        logTerminal(`New bid from ${driver.name}: ${fare} PKR.`);
    }

    // ═══════════════════════════════════════
    //  DRIVER BID DECISIONS
    // ═══════════════════════════════════════
    document.getElementById('d-btn-accept').addEventListener('click', () => {
        if (!activeTrip) return;
        addDriverBidCard(actualDriver, activeTrip.offeredFare);
        showDriverScreen('d-screen-home');
        logTerminal(`Ahmed Khan accepted passenger offer: ${activeTrip.offeredFare} PKR.`);
    });

    document.getElementById('d-btn-counter-50').addEventListener('click', () => {
        if (!activeTrip) return;
        const fare = activeTrip.offeredFare + 50;
        addDriverBidCard(actualDriver, fare);
        showDriverScreen('d-screen-home');
        logTerminal(`Ahmed Khan countered at +50 PKR: ${fare} PKR.`);
    });

    document.getElementById('d-btn-counter-100').addEventListener('click', () => {
        if (!activeTrip) return;
        const fare = activeTrip.offeredFare + 100;
        addDriverBidCard(actualDriver, fare);
        showDriverScreen('d-screen-home');
        logTerminal(`Ahmed Khan countered at +100 PKR: ${fare} PKR.`);
    });

    document.getElementById('d-btn-decline').addEventListener('click', () => {
        showDriverScreen('d-screen-home');
        logTerminal("Ahmed Khan declined the bid request.");
    });

    // ═══════════════════════════════════════
    //  HIRE DRIVER
    // ═══════════════════════════════════════
    const pActiveDriverImg = document.getElementById('p-active-driver-img');
    const pActiveDriverName = document.getElementById('p-active-driver-name');
    const pActiveDriverVehicle = document.getElementById('p-active-driver-vehicle');
    const pActiveDriverPlate = document.getElementById('p-active-driver-plate');
    const dNavTitle = document.getElementById('d-nav-title');
    const dNavFareLabel = document.getElementById('d-nav-fare-label');
    const dBtnFlowAction = document.getElementById('d-btn-flow-action');

    function hireDriver(driver, fare) {
        clearTimeout(bidTimeout1);
        clearTimeout(bidTimeout2);
        activeTrip.selectedFare = fare;
        activeTrip.driver = driver;
        activeTrip.stage = 'hub_walking';

        pActiveDriverImg.src = driver.img;
        pActiveDriverName.textContent = driver.name;
        pActiveDriverVehicle.textContent = `${driver.vehicle} · ${driver.rating}★`;
        pActiveDriverPlate.textContent = driver.plate;

        showPassengerScreen('p-screen-nav');

        if (driver.name === actualDriver.name) {
            dNavTitle.textContent = "Heading to Pickup Hub";
            dNavFareLabel.textContent = `${fare} PKR`;
            dBtnFlowAction.textContent = "Arrived at Hub";
            dBtnFlowAction.className = "w-full h-12 bg-secondary hover:bg-[#004493] text-white rounded-2xl font-black text-sm flex items-center justify-center transition-all shadow-lg";
            showDriverScreen('d-screen-nav');
        } else {
            logTerminal(`Simulated driver ${driver.name} hired. Driver app remains idle.`);
        }

        activePools++;
        updateAdminStats();
        updateOpsStats();
        logTerminal(`Ride confirmed! ${driver.name} hired at ${fare} PKR. Walking to hub...`, "success");
    }

    // ═══════════════════════════════════════
    //  DRIVER FLOW STATE MACHINE
    // ═══════════════════════════════════════
    dBtnFlowAction.addEventListener('click', () => {
        const txt = dBtnFlowAction.textContent.trim();

        if (txt === "Arrived at Hub") {
            dBtnFlowAction.textContent = "Start Journey";
            dBtnFlowAction.className = "w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-sm flex items-center justify-center transition-all shadow-lg";
            dNavTitle.textContent = "Boarding Passengers";
            logTerminal("Driver arrived at I-8/3 Markaz pickup hub. Boarding passengers.");
        }
        else if (txt === "Start Journey") {
            dBtnFlowAction.textContent = "Complete Ride";
            dBtnFlowAction.className = "w-full h-12 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-sm flex items-center justify-center transition-all shadow-lg";
            dNavTitle.textContent = "I-8 → G-10 Markaz";
            activeTrip.stage = 'en_route';
            showPassengerScreen('p-screen-tracking');
            logTerminal("All passengers boarded. Journey started! Route locked by AI.", "success");
        }
        else if (txt === "Complete Ride") {
            completeRide();
        }
    });

    // ═══════════════════════════════════════
    //  COMPLETE RIDE
    // ═══════════════════════════════════════
    function completeRide() {
        if (!activeTrip) return;
        const grossFare = activeTrip.selectedFare;
        const pShare = Math.round(grossFare / currentSeats);
        const driverPay = Math.round(grossFare * 0.9);
        const commission = Math.round(grossFare * 0.1);

        // Update totals
        totalRevenue += grossFare;
        totalCommissions += commission;
        totalDriverPayout += driverPay;
        totalDriverEarnings += driverPay;
        activePools = Math.max(0, activePools - 1);
        totalTrips++;

        // Passenger invoice
        const invoiceType = document.getElementById('p-invoice-type');
        if (invoiceType) invoiceType.textContent = activeTrip.rideType.toUpperCase();
        document.getElementById('p-invoice-seats').textContent = `${currentSeats} / 4`;
        document.getElementById('p-invoice-share').textContent = `${pShare} PKR`;
        showPassengerScreen('p-screen-invoice');

        // Driver earnings
        const dEarnings = document.getElementById('d-earnings-val');
        if (dEarnings) dEarnings.textContent = `${totalDriverEarnings} PKR`;
        const dRides = document.getElementById('d-rides-count');
        if (dRides) dRides.textContent = totalTrips;

        // Driver ledger
        updateDriverLedger(activeTrip, grossFare, driverPay, commission);

        // Admin dashboard
        updateAdminStats();
        updateFinancePanels();
        addAdminTripFeed(activeTrip, grossFare, pShare);
        updateOpsStats();

        showDriverScreen('d-screen-home');
        updateDriverHomeRecent(activeTrip, driverPay);

        logTerminal(`Ride complete! Gross: ${grossFare} PKR · Passenger Share: ${pShare} PKR · Platform: ${commission} PKR · Driver Payout: ${driverPay} PKR`, "success");
        activeTrip = null;
    }

    // Force complete trip button
    ctrlBtnComplete.addEventListener('click', () => {
        if (activeTrip && activeTrip.stage === 'en_route') {
            completeRide();
        } else if (activeTrip) {
            logTerminal("Trip not yet in en-route state. Complete hub steps first.", "warning");
        } else {
            logTerminal("No active trip to complete.", "warning");
        }
    });

    document.getElementById('p-btn-complete-confirm').addEventListener('click', () => {
        showPassengerScreen('p-screen-home');
    });

    // ═══════════════════════════════════════
    //  DRIVER LEDGER
    // ═══════════════════════════════════════
    function updateDriverLedger(trip, gross, driverPay, commission) {
        const container = document.getElementById('d-ledger-container');
        const emptyState = container.querySelector('.text-center');
        if (emptyState) emptyState.remove();

        const card = document.createElement('div');
        card.className = "bg-white border border-gray-200 rounded-2xl p-4 text-xs space-y-1.5 shadow-sm slide-up";
        card.innerHTML = `
            <div class="flex justify-between font-black text-sm">
                <span class="text-gray-800">Bahria → G-10</span>
                <span class="text-emerald-700">+${driverPay} PKR</span>
            </div>
            <div class="flex justify-between text-[10px] text-gray-400">
                <span>Gross: ${gross} PKR · Commission: ${commission} PKR</span>
            </div>
            <div class="flex gap-2">
                <span class="badge-info">${trip.rideType.toUpperCase()}</span>
                <span class="badge-success">${currentSeats} seat(s)</span>
                <span class="${trip.passengerGender === 'female' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'} px-2 py-0.5 rounded text-[9px] font-bold">${trip.passengerGender === 'female' ? 'Female Pool' : 'Male Pool'}</span>
            </div>
        `;
        container.insertBefore(card, container.firstChild);

        // Update ledger totals
        const ledgerTotal = document.getElementById('d-ledger-total');
        const ledgerFee = document.getElementById('d-ledger-fee');
        const ledgerTrips = document.getElementById('d-ledger-trips');
        if (ledgerTotal) ledgerTotal.textContent = `${totalDriverEarnings} PKR`;
        if (ledgerFee) ledgerFee.textContent = `${totalCommissions} PKR`;
        if (ledgerTrips) ledgerTrips.textContent = `${totalTrips}`;
    }

    function updateDriverHomeRecent(trip, driverPay) {
        const container = document.getElementById('d-recent-trips-home');
        if (!container) return;
        container.innerHTML = '';
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-3 text-xs";
        item.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
                    <span class="material-symbols-outlined text-emerald-600 text-[14px]">check_circle</span>
                </div>
                <div><p class="font-bold text-gray-800">Bahria → G-10</p><p class="text-[9px] text-gray-400">${trip.rideType.toUpperCase()} · ${currentSeats} seat(s)</p></div>
            </div>
            <span class="font-black text-emerald-700">+${driverPay} PKR</span>
        `;
        container.appendChild(item);
    }

    // ═══════════════════════════════════════
    //  ADMIN STAT UPDATERS
    // ═══════════════════════════════════════
    function updateAdminStats() {
        if (adminActivePools) adminActivePools.textContent = activePools;
        if (adminRevenue) adminRevenue.textContent = `${totalRevenue} PKR`;
        if (adminCommissions) adminCommissions.textContent = `${totalCommissions} PKR`;

        // Progress bars
        const revBar = document.getElementById('admin-rev-bar');
        if (revBar) revBar.style.width = `${Math.min(100, totalRevenue / 50)}%`;
        const commBar = document.getElementById('admin-comm-bar');
        if (commBar) commBar.style.width = `${Math.min(100, totalCommissions / 5)}%`;
        const poolsBar = document.getElementById('admin-pools-bar');
        if (poolsBar) poolsBar.style.width = `${Math.min(100, activePools * 20)}%`;

        // SOS / deviation counts
        const sosCnt = document.getElementById('admin-sos-count');
        const devCnt = document.getElementById('admin-dev-count');
        const panelSos = document.getElementById('admin-panel-sos');
        const panelDev = document.getElementById('admin-panel-dev');
        if (sosCnt) sosCnt.textContent = sosCount;
        if (devCnt) devCnt.textContent = devCount;
        if (panelSos) panelSos.textContent = sosCount;
        if (panelDev) panelDev.textContent = devCount;
    }

    function updateFinancePanels() {
        const fr = document.getElementById('admin-finance-rev');
        const fc = document.getElementById('admin-finance-comm');
        const fp = document.getElementById('admin-finance-payout');
        if (fr) fr.textContent = `${totalRevenue} PKR`;
        if (fc) fc.textContent = `${totalCommissions} PKR`;
        if (fp) fp.textContent = `${totalDriverPayout} PKR`;

        // Finance log entry
        const log = document.getElementById('admin-finance-log');
        if (log) {
            const emptyMsg = log.querySelector('div.px-6');
            if (emptyMsg && emptyMsg.textContent.includes('No transactions')) emptyMsg.remove();
            const row = document.createElement('div');
            row.className = "flex justify-between items-center px-6 py-3 text-xs border-b border-gray-50";
            row.innerHTML = `
                <div>
                    <p class="font-bold text-gray-800">Bahria → G-10 (${activeTrip ? activeTrip.rideType : selectedRideType})</p>
                    <p class="text-[9px] text-gray-400">${new Date().toLocaleTimeString()}</p>
                </div>
                <div class="text-right">
                    <p class="font-black text-emerald-700">+${totalCommissions} PKR</p>
                    <p class="text-[9px] text-gray-400">Commission</p>
                </div>
            `;
            log.insertBefore(row, log.firstChild);
        }
    }

    function addAdminTripFeed(trip, gross, share) {
        const feed = document.getElementById('admin-trips-feed');
        if (!feed) return;
        const emptyMsg = feed.querySelector('.px-6');
        if (emptyMsg && emptyMsg.textContent.includes('Complete a ride')) emptyMsg.remove();

        const liveEl = document.getElementById('admin-live-trips');
        if (liveEl) liveEl.textContent = `${totalTrips}`;

        const row = document.createElement('div');
        row.className = "flex items-center justify-between px-6 py-4 text-xs slide-up";
        row.innerHTML = `
            <div>
                <p class="font-black text-gray-800">Bahria Ph-7 → G-10 Markaz</p>
                <p class="text-[9px] text-gray-400">${trip.rideType.toUpperCase()} · ${currentSeats} passengers · Ahmed Khan</p>
            </div>
            <div class="text-right">
                <span class="badge-success">Completed</span>
                <p class="text-[10px] font-black text-primary mt-1">${gross} PKR</p>
            </div>
        `;
        feed.insertBefore(row, feed.firstChild);
    }

    function updateOpsStats() {
        const opsRides = document.getElementById('ops-active-rides');
        if (opsRides) opsRides.textContent = activePools;
    }

    // ═══════════════════════════════════════
    //  DRIVER LEDGER NAVIGATION
    // ═══════════════════════════════════════
    document.getElementById('d-btn-ledger').addEventListener('click', () => showDriverScreen('d-screen-ledger'));
    document.getElementById('d-btn-back-ledger').addEventListener('click', () => showDriverScreen('d-screen-home'));
    document.getElementById('d-btn-see-ledger').addEventListener('click', () => showDriverScreen('d-screen-ledger'));

    // ═══════════════════════════════════════
    //  WALK TIMER
    // ═══════════════════════════════════════
    function startPassengerWalkTimer() {
        walkTimeSeconds = 270;
        updateWalkTimer();
        pWalkTimerInterval = setInterval(() => {
            if (walkTimeSeconds > 0) {
                walkTimeSeconds--;
                updateWalkTimer();
            } else {
                clearInterval(pWalkTimerInterval);
                const el = document.getElementById('p-walk-timer');
                if (el) el.textContent = "Arrived!";
            }
        }, 1000);
    }
    function stopPassengerWalkTimer() {
        if (pWalkTimerInterval) clearInterval(pWalkTimerInterval);
    }
    function updateWalkTimer() {
        const el = document.getElementById('p-walk-timer');
        if (!el) return;
        const m = Math.floor(walkTimeSeconds / 60);
        const s = walkTimeSeconds % 60;
        el.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    }

    // ═══════════════════════════════════════
    //  CAR TRACKING ANIMATION
    // ═══════════════════════════════════════
    let trackingAngle = 0;
    function startDriverCarTrackingAnimation() {
        trackingAngle = 0;
        carTrackingInterval = setInterval(() => {
            trackingAngle += 0.08;
            const xOff = Math.sin(trackingAngle) * 14;
            const yOff = Math.cos(trackingAngle * 0.5) * 8;
            const rot = Math.cos(trackingAngle) * 12;
            const t = `translate(${xOff}px, ${yOff}px) rotate(${rot}deg)`;
            const pMarker = document.getElementById('p-map-car-marker');
            const dMarker = document.getElementById('d-map-car-marker');
            if (pMarker) pMarker.style.transform = t;
            if (dMarker) dMarker.style.transform = t;
        }, 600);
    }
    function stopDriverCarTrackingAnimation() {
        if (carTrackingInterval) clearInterval(carTrackingInterval);
    }

    // ═══════════════════════════════════════
    //  SEAT SLIDER
    // ═══════════════════════════════════════
    seatsCtrlSlider.addEventListener('input', (e) => {
        currentSeats = parseInt(e.target.value);
        seatsCtrlVal.textContent = `${currentSeats} / 4`;
        const baseFare = activeTrip ? activeTrip.selectedFare : (baseFares[selectedRideType] || 400);
        if (fareShare) fareShare.textContent = `${Math.round(baseFare / currentSeats)} PKR`;
        updateSeatUI();
    });

    function updateSeatUI() {
        const frontIcon = document.getElementById('p-seat-front-icon');
        const frontLabel = document.getElementById('p-seat-front-label');
        const backrightIcon = document.getElementById('p-seat-backright-icon');
        const backrightLabel = document.getElementById('p-seat-backright-label');

        [frontIcon, backrightIcon].forEach(icon => {
            if (icon) { icon.className = "material-symbols-outlined text-outline text-[22px]"; icon.textContent = "airline_seat_recline_extra"; }
        });
        if (frontLabel) { frontLabel.className = "text-[7px] font-bold text-outline"; frontLabel.textContent = "Empty"; }
        if (backrightLabel) { backrightLabel.className = "text-[7px] font-bold text-outline"; backrightLabel.textContent = "Empty"; }

        if (currentSeats >= 2 && frontIcon) {
            frontIcon.className = "material-symbols-outlined text-primary text-[22px] fill-icon";
            frontIcon.textContent = "person";
            if (frontLabel) { frontLabel.className = "text-[7px] font-bold text-gray-500"; frontLabel.textContent = "Passenger"; }
        }
        if (currentSeats >= 3 && backrightIcon) {
            backrightIcon.className = "material-symbols-outlined text-primary text-[22px] fill-icon";
            backrightIcon.textContent = "person";
            if (backrightLabel) { backrightLabel.className = "text-[7px] font-bold text-gray-500"; backrightLabel.textContent = "Passenger"; }
        }
    }

    // ═══════════════════════════════════════
    //  GENDER SELECTOR
    // ═══════════════════════════════════════
    pCtrlMale.addEventListener('click', () => {
        userGender = 'male';
        pCtrlMale.className = "py-2 bg-blue-50 border-2 border-blue-600 text-blue-700 rounded-xl font-black text-[10px] flex items-center justify-center gap-1";
        pCtrlFemale.className = "py-2 border-2 border-gray-200 text-gray-500 rounded-xl font-semibold text-[10px] flex items-center justify-center gap-1";
        const tag = document.getElementById('p-seat-gender-tag');
        if (tag) { tag.innerHTML = `<span class="material-symbols-outlined text-[10px]">male</span> Male Pool`; tag.className = "flex items-center gap-0.5 px-2 py-0.5 bg-blue-50 text-[#0058bb] rounded-full text-[9px] font-bold"; }
    });

    pCtrlFemale.addEventListener('click', () => {
        userGender = 'female';
        pCtrlFemale.className = "py-2 bg-purple-50 border-2 border-purple-600 text-purple-700 rounded-xl font-black text-[10px] flex items-center justify-center gap-1";
        pCtrlMale.className = "py-2 border-2 border-gray-200 text-gray-500 rounded-xl font-semibold text-[10px] flex items-center justify-center gap-1";
        const tag = document.getElementById('p-seat-gender-tag');
        if (tag) { tag.innerHTML = `<span class="material-symbols-outlined text-[10px]">female</span> Female Pool`; tag.className = "flex items-center gap-0.5 px-2 py-0.5 bg-purple-50 text-[#70008b] rounded-full text-[9px] font-bold"; }
    });

    // ═══════════════════════════════════════
    //  SAFETY: SOS & DEVIATION
    // ═══════════════════════════════════════
    const globalSosModal = document.getElementById('global-sos-modal');
    const pRouteDeviationBanner = document.getElementById('p-route-deviation-banner');

    function triggerSos() {
        globalSosModal.classList.remove('hidden');
        sosCount++;
        updateAdminStats();
        logTerminal("🚨 EMERGENCY SOS TRIGGERED! Location + plate shared with Islamabad Police.", "error");

        const safetyDesk = document.getElementById('admin-safety-desk');
        if (safetyDesk) {
            const alert = document.createElement('div');
            alert.className = "p-3 bg-red-100 border border-red-300 text-red-900 rounded-xl text-xs flex justify-between items-center slide-up";
            alert.innerHTML = `<div><h4 class="font-black">SOS ALERT</h4><p class="text-[9px]">Driver: Ahmed Khan · Toyota Corolla (LEC-4820)</p></div><span class="badge-error">DISPATCHING</span>`;
            safetyDesk.insertBefore(alert, safetyDesk.firstChild);
        }
    }

    ctrlBtnSos.addEventListener('click', triggerSos);
    document.querySelectorAll('.btn-sos-trigger, .sos-tag').forEach(btn => btn.addEventListener('click', triggerSos));
    document.getElementById('btn-cancel-global-sos').addEventListener('click', () => {
        globalSosModal.classList.add('hidden');
        logTerminal("SOS alert cancelled by user.");
    });

    ctrlBtnDeviation.addEventListener('click', () => {
        isDeviating = !isDeviating;
        if (isDeviating) {
            pRouteDeviationBanner.classList.remove('hidden');
            ctrlBtnDeviation.innerHTML = `<span class="material-symbols-outlined text-[14px]">check_circle</span> Clear Deviation Alert`;
            ctrlBtnDeviation.className = "w-full py-2.5 bg-amber-700 text-white rounded-xl font-black text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-sm";
            devCount++;
            updateAdminStats();
            logTerminal("⚠️ GPS Deviation: Vehicle LEC-4820 off optimised corridor. Admin notified.", "warning");

            const safetyDesk = document.getElementById('admin-safety-desk');
            if (safetyDesk) {
                const alert = document.createElement('div');
                alert.id = "admin-deviation-row";
                alert.className = "p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl text-xs flex justify-between items-center slide-up";
                alert.innerHTML = `<div><h4 class="font-black">ROUTE DEVIATION</h4><p class="text-[9px]">Vehicle LEC-4820 deviated in Sector I-8</p></div><span class="badge-warn">MONITORING</span>`;
                safetyDesk.insertBefore(alert, safetyDesk.firstChild);
            }
        } else {
            pRouteDeviationBanner.classList.add('hidden');
            ctrlBtnDeviation.innerHTML = `<span class="material-symbols-outlined text-[14px]">warning</span> Simulate Route Deviation`;
            ctrlBtnDeviation.className = "w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-black text-[10px] flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] shadow-sm";
            logTerminal("Route deviation cleared. Vehicle back in corridor.");
            const row = document.getElementById('admin-deviation-row');
            if (row) row.remove();
        }
    });

    // ═══════════════════════════════════════
    //  STAR RATING
    // ═══════════════════════════════════════
    document.querySelectorAll('.star-item').forEach(star => {
        star.addEventListener('click', function() {
            const val = parseInt(this.dataset.val);
            document.querySelectorAll('.star-item').forEach((s, i) => {
                if (i < val) {
                    s.className = "star-item material-symbols-outlined text-[28px] star-filled fill-icon cursor-pointer";
                } else {
                    s.className = "star-item material-symbols-outlined text-[28px] star-empty cursor-pointer";
                    s.style.fontVariationSettings = "";
                }
            });
            logTerminal(`Passenger rated driver ${val}/5 stars.`, "success");
        });
    });

    // ═══════════════════════════════════════
    //  INIT STATE
    // ═══════════════════════════════════════
    showPassengerScreen('p-screen-home');
    showDriverScreen('d-screen-register');

    logTerminal("ShareRide Pakistan AI Engine v2.4 initialized. Islamabad Zone active.");
    logTerminal("Step 1: Switch to Admin tab → Driver Approvals → Approve Ahmed Khan");
    logTerminal("Step 2: Toggle driver ONLINE → Step 3: Book a ride on Passenger App");

    updateAdminStats();
    updateSeatUI();
});
