import axios, { AxiosInstance } from 'axios';
import { 
  User, 
  Connection, 
  ConnectionCreate, 
  DirectoryListing, 
  FileInfo,
  AuthToken 
} from '../types';

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000/api',
    });

    // Add auth token to requests
    this.api.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Handle auth errors
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('access_token');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );
  }

  // Auth endpoints
  async login(username: string, password: string): Promise<AuthToken> {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await this.api.post<AuthToken>('/auth/token', formData);
    localStorage.setItem('access_token', response.data.access_token);
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.api.get<User>('/auth/me');
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.api.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  // Admin endpoints
  async getConnections(): Promise<Connection[]> {
    const response = await this.api.get<Connection[]>('/admin/connections');
    return response.data;
  }

  async createConnection(connection: ConnectionCreate): Promise<Connection> {
    const response = await this.api.post<Connection>('/admin/connections', connection);
    return response.data;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.api.delete(`/admin/connections/${connectionId}`);
  }

  async testConnection(connectionId: string): Promise<{ status: string; message: string }> {
    const response = await this.api.post(`/admin/connections/${connectionId}/test`);
    return response.data;
  }

  // Browse endpoints
  async listDirectory(connectionId: string, path: string = ''): Promise<DirectoryListing> {
    const response = await this.api.get<DirectoryListing>(
      `/browse/${connectionId}/list`,
      { params: { path } }
    );
    return response.data;
  }

  async getFileInfo(connectionId: string, path: string): Promise<FileInfo> {
    const response = await this.api.get<FileInfo>(
      `/browse/${connectionId}/info`,
      { params: { path } }
    );
    return response.data;
  }

  // Preview endpoints
  getPreviewUrl(connectionId: string, path: string): string {
    const token = localStorage.getItem('access_token');
    const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';
    return `${baseUrl}/preview/${connectionId}/file?path=${encodeURIComponent(path)}&token=${token}`;
  }

  getDownloadUrl(connectionId: string, path: string): string {
    const token = localStorage.getItem('access_token');
    const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';
    return `${baseUrl}/preview/${connectionId}/download?path=${encodeURIComponent(path)}&token=${token}`;
  }

  async getFileContent(connectionId: string, path: string): Promise<string> {
    const token = localStorage.getItem('access_token');
    const response = await this.api.get(`/preview/${connectionId}/file`, {
      params: { path },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: 'text',
    });
    return response.data;
  }
}

export const apiService = new ApiService();