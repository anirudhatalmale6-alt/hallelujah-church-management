# Hallelujah In The City - Church Management System

A web-based church management system for tracking members, services, and attendance.

## Tech Stack

- **Backend**: PHP 8+ REST API (no framework)
- **Database**: MySQL
- **Frontend**: React (Vite) + Tailwind CSS
- **Auth**: JWT tokens with bcrypt password hashing
- **Hosting**: Shared hosting (Hostinger, LiteSpeed/Apache)

## Setup & Deployment

### Prerequisites

- PHP 8.0+ with PDO MySQL extension
- MySQL 5.7+ or MariaDB 10.3+
- Node.js 18+ (for building frontend only)
- Apache/LiteSpeed with mod_rewrite enabled

### 1. Upload Files

Upload the entire project directory to your hosting public_html folder:

```
public_html/
  api/
  public/
  schema.sql
  .htaccess
```

### 2. Configure Database

Edit `api/config.php` and update the database credentials:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'church_management');
define('DB_USER', 'your_db_user');
define('DB_PASS', 'your_db_password');
define('JWT_SECRET', 'change-this-to-a-random-string');
```

Or set environment variables: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `JWT_SECRET`.

### 3. Run Installation

Navigate to `https://yourdomain.com/public/install` in your browser and click "Install Now".

This will:
- Create the database and tables
- Insert default settings
- Create the admin account

**Default Admin Login:**
- Email: `admin@hallelujahinthecity.org`
- Password: `Admin123!`

Change this password immediately after first login.

### 4. Build Frontend (Development)

If you need to modify the frontend:

```bash
cd frontend
npm install
npm run build    # Outputs to ../public/
npm run dev      # Dev server with hot reload
```

## Project Structure

```
church-management/
  api/
    config.php        # DB connection, JWT config, CORS
    auth.php          # Login & token verification
    users.php         # System user CRUD
    members.php       # Church member CRUD
    services.php      # Service CRUD
    attendance.php    # Attendance marking & history
    dashboard.php     # Dashboard statistics
    settings.php      # System settings
    install.php       # First-time setup
  frontend/           # React source (Vite)
    src/
      components/     # Shared UI components
      contexts/       # React context (auth)
      pages/          # Page components
      utils/          # API client
  public/             # Built frontend (served by Apache)
  schema.sql          # Database schema
  .htaccess           # URL rewriting rules
```

## User Roles

| Role | Permissions |
|------|-------------|
| Pastor | Full access to everything |
| Admin | Full access to everything |
| Leader | Manage members, services, attendance |
| Volunteer | View members, mark attendance |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth?action=login | Login |
| GET | /api/auth?action=me | Get current user |
| GET/POST/PUT/DELETE | /api/members | Member CRUD |
| GET/POST/PUT/DELETE | /api/services | Service CRUD |
| GET/POST | /api/attendance | Attendance management |
| GET | /api/dashboard | Dashboard statistics |
| GET/PUT | /api/settings | System settings |
| GET/POST | /api/install | System installation |
| GET/POST/PUT/DELETE | /api/users | User management |

## Version

v1.0 - Milestone 1: Core System + Members + Attendance
