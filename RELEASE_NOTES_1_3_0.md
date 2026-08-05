# Velocity v1.3.0 - Special Rides Release

**Release Date:** August 5, 2026  
**Version Code:** (Auto-incremented by EAS)  
**Type:** Major Feature Release

---

## 🎉 What's New

### 🚗 Special Rides - Daily Vehicle Rentals (NEW FEATURE)

Introducing **Special Rides**, a complete platform for daily car rentals directly within Velocity. Post your vehicle, browse available cars, and book rentals for any duration—with optional professional drivers.

#### For Users:
- **Browse Available Cars** - Discover rental cars in your area with full details (make, model, year, seats, transmission, mileage, pricing)
- **Post Your Car** - Submit your vehicle for daily rental with photos, insurance documents, and pricing
- **Easy Booking** - Select dates, add optional driver service (+₨1,000/day), and confirm your rental
- **My Posted Cars** - Track your posted vehicles and bookings (approval-gated—only active hosts see this)
- **Multi-day Rentals** - Flexible booking for any duration with transparent pricing breakdown

#### For Admins:
- **Rental Applications** - Review and approve/reject user car postings
- **Listings Management** - Monitor active rentals and suspend listings if needed
- **Host Dashboard** - View all rental hosts and their activity stats
- **Real-time Updates** - Live Firestore listeners for instant admin visibility

---

## 🔧 Technical Improvements

### Mobile App
- **Sidebar Navigation Updates**
  - Removed "Couriers" from sidebar (already accessible from home screen)
  - Merged "Request history" + "Saved places" into single "Request history & Saved places" feature
  - Added new "Special Rides" navigation item
  - Hidden mascot from "where to" box (coming in future releases)

- **New Screens**
  - `special-rides/index.tsx` - Main dashboard & listings browser
  - `special-rides/compose.tsx` - Car posting form with validation
  - `special-rides/details.tsx` - Car details with booking interface
  - `special-rides/my-cars.tsx` - Host dashboard (approval-gated)
  - `special-rides/booking-confirmation.tsx` - Booking confirmation

### Backend
- **New Special Rides Module** (`backend/functions/src/specialRides/`)
  - Complete application & approval workflow
  - Listing management with status tracking
  - Booking flow with confirmation
  - Host suspension capabilities
  - Admin review functions

- **API Functions** (11 new Cloud Functions)
  - `submitSpecialRidesApplication` - Post car for rental
  - `adminReviewSpecialRidesApplication` - Admin approve/reject
  - `getSpecialRidesDashboard` - User dashboard state
  - `getSpecialRidesListings` - Browse approved cars
  - `bookSpecialRidesCar` - Create rental booking
  - Plus 6 more management functions

### Firestore
- **New Collections**
  - `specialRidesApplications/{uid}` - Submission queue with documents
  - `specialRidesListings/{uid}` - Active rental cars
  - `specialRidesBookings/{bookingId}` - Rental bookings

- **Security Rules** - Full RBAC for:
  - Owner-only application access
  - Public listing browsing
  - Renter/host/admin booking access

### Admin Dashboard
- **New Admin Page** - `/dashboard/special-rides`
  - Pending applications tab (approve/reject)
  - Active listings management (suspend/reactivate)
  - Real-time Firestore listeners
  - Admin navigation integration

---

## 📊 Feature Details

### Car Posting Flow
1. User taps "Special Rides" → "Post Your Car"
2. Fills in:
   - Car details (make, model, year, seats, transmission, mileage, color)
   - Location (city, address)
   - Daily rental price (₨500-10,000 range)
   - Contact information (name, phone)
   - Optional instructions for renters
3. Submits for admin review (status: pending)
4. Admin approves/rejects
5. Once approved, "My Posted Cars" appears in sidebar

### Booking Flow
1. Browse Special Rides → See all approved cars
2. Tap car → View full details and owner contact
3. Select pickup and return dates
4. Optional: Add professional driver (+₨1,000/day)
5. View price breakdown
6. Book now → Host receives booking request
7. Host confirms → Booking confirmed
8. Complete payment and arrange pickup

### Multi-State Dashboard
- **none** - No posting activity yet
- **pending** - Application under admin review
- **rejected** - Application rejected (can resubmit)
- **active** - Approved and live
- **suspended** - Admin suspended (can't accept new bookings)

---

## 🛡️ Safety & Compliance

✅ **Security Features:**
- Role-based access control (owner/admin/user)
- Firestore security rules enforce authentication
- Admin-only approval workflow
- Document upload support for insurance & registration
- Host verification before activation
- Automatic suspension capabilities

✅ **Data Privacy:**
- Owner contact info restricted to admin + approved renters
- Firestore rules enforce principle of least privilege
- Booking data accessible only to parties involved

---

## 🚀 Performance

- **Optimized Firestore Queries** - Indexed for fast lookups
- **Real-time Updates** - Live listeners for admin dashboard
- **Efficient State Management** - Multi-stage dashboard reduces database calls
- **Offline Support** - Firestore caching for seamless experience

---

## 📝 Known Limitations & Future Enhancements

### Coming Soon (Next Release)
- Photo upload integration (currently placeholder)
- Document upload for insurance/registration
- Native date picker for booking (currently manual entry)
- Payment integration with existing provider
- Push notifications for booking confirmations
- Driver matching algorithm
- User reviews & ratings for rentals
- In-app messaging between host and renter

### Not Included (Scope)
- Insurance verification automation (manual review for now)
- License plate recognition
- Damage assessment features
- Delivery/drop-off service

---

## 🐛 Bug Fixes

- Fixed TypeScript compilation errors in special-rides screens
- Resolved navigation state management issues
- Fixed Firestore collection querying

---

## 📱 Compatibility

- **Min Android Version:** 5.1 (API 22)
- **Target Android Version:** 14 (API 34)
- **React Native Version:** Expo SDK 56
- **TypeScript:** v5

---

## 🔐 Security Notes

⚠️ **For Play Store Submission:**
- Ensure "Photos" permission is needed for car listing photos
- "Camera" permission for photo capture
- "Microphone" permission remains for voice booking feature
- Insurance document upload uses Firebase Storage with access control

---

## 📲 Installation & Update

1. **For Existing Users**
   - Auto-update available through Play Store
   - No breaking changes to existing features
   - Backward compatible with previous app versions

2. **First-time Users**
   - Download from Play Store
   - Complete onboarding flow
   - Access Special Rides immediately

---

## 👨‍💼 For Admins

**New Admin Capabilities:**
1. Navigate to `/dashboard/special-rides`
2. **Pending Applications Tab**
   - Review car details submitted by users
   - View insurance & registration documents (placeholder URLs)
   - Approve → Creates active listing
   - Reject → User can resubmit with reason
3. **Active Listings Tab**
   - Monitor all approved rentals
   - Suspend listings if needed
   - View host contact information

**Admin Workflow:**
- Applications arrive in "Pending Applications" tab
- Review documents and car details
- Approve (auto-creates listing) or reject with reason
- Suspended listings can be reactivated

---

## 📞 Support

**For Users:**
- In-app support chat available from Settings
- Report issues through app feedback

**For Admins:**
- Dashboard has real-time updates
- Check admin logs for approval history
- Contact support for complex cases

---

## 📋 Changelog

### Added
- ✨ Special Rides feature (rent-a-car platform)
- ✨ 5 new mobile screens with full functionality
- ✨ 11 new backend Cloud Functions
- ✨ 3 new Firestore collections with security rules
- ✨ Admin dashboard for rental management
- ✨ Multi-state user dashboard (none/pending/rejected/active/suspended)
- ✨ Car posting form with validation
- ✨ Rental booking flow with price calculation
- ✨ Host approval workflow with admin review
- ✨ Firestore collection indexes for performance

### Changed
- 🔄 Updated app version to 1.3.0
- 🔄 Sidebar navigation: removed Courier, merged Saved Places + History
- 🔄 Hidden mascot from "where to" box for future release

### Fixed
- 🐛 TypeScript compilation errors in special-rides screens
- 🐛 Navigation state management
- 🐛 Firestore query efficiency

---

## 🙏 Thanks

Built with ❤️ for Pakistan's ride-sharing community.

Special thanks to:
- Expo team for seamless React Native development
- Firebase for real-time backend infrastructure
- Our beta testers for feedback

---

**Questions? Feedback?** Contact us through the app or visit our support center.

**Download Velocity v1.3.0 now from Google Play Store!** 🚀
