import { Controller, Post, Req, Get, Patch, Delete, Param, Body, UseGuards, UsePipes, ValidationPipe, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetUser } from '../auth/get-user.decorator';
import { ReportsService } from './reports.service';
import { FastifyRequest } from 'fastify';
import { UpdateReportDto } from './dto/update-report.dto';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('analyze')
  async analyzeReportImage(
    @Req() req: any,
  ) {
    const fastifyReq = req as FastifyRequest;
    if (!fastifyReq.isMultipart()) {
      throw new BadRequestException('Format request harus berupa multipart/form-data');
    }

    const fileData = await fastifyReq.file();
    if (!fileData) {
      throw new BadRequestException('Berkas foto laporan wajib diunggah');
    }

    const fileBuffer = await fileData.toBuffer();
    return this.reportsService.analyzeImage(fileBuffer, fileData.mimetype);
  }

  @Post()
  async uploadReport(
    @Req() req: any,
    @GetUser('id') userId: string,
  ) {
    const fastifyReq = req as FastifyRequest;
    // 1. Cek apakah format request berupa multipart
    if (!fastifyReq.isMultipart()) {
      throw new BadRequestException('Format request harus berupa multipart/form-data');
    }

    // 2. Ambil berkas berkas file
    const fileData = await fastifyReq.file();
    if (!fileData) {
      throw new BadRequestException('Berkas foto laporan wajib diunggah');
    }

    const fileBuffer = await fileData.toBuffer();

    // 3. Ekstrak data field non-file (latitude, longitude, description)
    const latField = fileData.fields.latitude;
    const lngField = fileData.fields.longitude;
    const descField = fileData.fields.description;

    if (!latField || !lngField) {
      throw new BadRequestException('Field latitude dan longitude wajib diisi');
    }

    const lat = parseFloat((latField as any).value);
    const lng = parseFloat((lngField as any).value);
    const description = (descField as any)?.value;

    if (isNaN(lat) || isNaN(lng)) {
      throw new BadRequestException('Latitude dan longitude harus berupa angka desimal yang valid');
    }

    return this.reportsService.createReport(
      userId,
      fileBuffer,
      fileData.mimetype,
      lat,
      lng,
      description,
    );
  }

  @Get()
  getReports() {
    return this.reportsService.getReports();
  }

  // --- Endpoint Khusus Admin ---

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  updateReport(
    @Param('id') reportId: string,
    @Body() updateDto: UpdateReportDto,
  ) {
    return this.reportsService.updateReport(reportId, updateDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  deleteReport(@Param('id') reportId: string) {
    return this.reportsService.deleteReport(reportId);
  }
}
